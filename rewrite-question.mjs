/**
 * rewrite-question — a DSH host plugin that rewrites each user chat message
 * into a formal, logically-corrected form before the model answers it.
 *
 * It hooks the `agent/pre-step` waterfall (the same extension point used by
 * the hook system, plan mode and compaction). For every entering
 * user-originated message it makes one short standalone LLM call that
 * re-types and de-bugs the message, then substitutes the rewritten message so
 * the answering model answers the corrected question. The original text is
 * what you typed; the rewritten text is what the AI actually sees.
 *
 * Runtime safety:
 *  - The auxiliary call goes straight through the LLM adapter — it never
 *    re-enters the agent loop, so there is no recursion/deadlock.
 *  - Any failure (no route, timeout, LLM error) falls back to passing the
 *    original message through unchanged; rewriting never breaks a chat.
 *  - Only user messages (`source.kind === 'user'`) with plain-text content
 *    are rewritten — runtime/snapshot context, attachments and slash commands
 *    are left untouched.
 *  - Each new user turn gets at most one rewrite pass.
 *
 * Deployment:
 *  drop this file into a DSH profile directory (e.g. `~/.dsh/profiles/web/`)
 *  and reference it from that profile's hot-reloaded `cordis.patch.yml`:
 *
 *    - insert:
 *        - id: rewrite-question
 *          name: './rewrite-question.mjs'
 *          config:
 *            maxOutputTokens: 4096
 *            timeoutMs: 120000
 *
 * Note: keep `maxOutputTokens` generous. DeepSeek-V4-Flash is a reasoning
 * model: with a small budget it spends the whole limit on reasoning tokens
 * and returns no content at all (finish_reason=length, content=null), which
 * makes the rewrite silently fall back to the original message. 4096 gives
 * the model room to reason AND write the corrected text.
 *
 * In-box packages resolve through the profile's flat `node_modules` fallback.
 */

import { appendFileSync } from 'node:fs'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'

/** Stable plugin identity used in emitted logs/requests. */
const REWRITE_SOURCE = 'dsh-rewrite-question'

/** Default strategy prompt; overridable via config `instruction`. */
const DEFAULT_INSTRUCTION_TEXT = [
  'You rewrite user questions before they are answered.',
  'Rephrase the user message into formal, idiomatic, logically-correct language.',
  "Fix spelling, grammar, word order, and any logical or factual error, making the user's intent unambiguous — without inventing new requirements.",
  'Preserve the original language and the original meaning.',
  'Return ONLY the corrected question as plain text, in the same language as the input.',
  'No quotes, no prefix, no explanation, no Markdown, and do not answer the question.',
].join('\n')

/** Abort reason used when a rewrite call exceeds the configured deadline. */
const REWRITE_TIMEOUT_CODE = 'REWRITE_TIMEOUT'

/** Sentinel returned by {@link resolveRoute} when no model route is available. */
const NO_ROUTE = Symbol('no-route')

/** Validate untrusted loader config and fill defaults. */
function validateConfig(input) {
  const src = typeof input === 'object' && input !== null ? input : {}
  const provider = typeof src.provider === 'string' && src.provider.length > 0 ? src.provider : undefined
  const model = typeof src.model === 'string' && src.model.length > 0 ? src.model : undefined
  return {
    enabled: src.enabled !== false,
    provider,
    model,
    useConfiguredRoute: provider !== undefined && model !== undefined,
    instruction: typeof src.instruction === 'string' && src.instruction.length > 0
      ? src.instruction
      : DEFAULT_INSTRUCTION_TEXT,
    maxOutputTokens: boundingValue(src.maxOutputTokens, 1, 16384, 4096),
    timeoutMs: boundingValue(src.timeoutMs, 1, 600000, 30000),
  }
}

/** Clamp an integer config value into a safe inclusive range with a default. */
function boundingValue(value, min, max, fallback) {
  if (!Number.isInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** True only when all of a message's content blocks are plain text. */
function isPlainTextContent(content) {
  return Array.isArray(content) && content.length > 0 && content.every((block) => block.type === 'text')
}

/** Join a plain-text message's text blocks into one string. */
function plainText(content) {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

/** Resolve the model route: configured pair wins, else the session's live
 * request header (where the GUI records the per-session model), else options. */
function resolveRoute(config, agent) {
  if (config.useConfiguredRoute) return { provider: config.provider, model: config.model }
  const headerConfig = agent?.session?.requestHeader?.()?.config
  if (headerConfig
    && typeof headerConfig.provider === 'string' && headerConfig.provider.length > 0
    && typeof headerConfig.model === 'string' && headerConfig.model.length > 0) {
    return { provider: headerConfig.provider, model: headerConfig.model }
  }
  const options = agent?.options ?? {}
  if (typeof options.provider === 'string' && options.provider.length > 0
    && typeof options.model === 'string' && options.model.length > 0) {
    return { provider: options.provider, model: options.model }
  }
  return NO_ROUTE
}

/**
 * One standalone rewrite call, modeled on the session-title auxiliary call.
 * Returns the corrected text, or `undefined` to keep the original message.
 */
async function rewriteUser(ctx, route, sessionId, text, signal, config) {
  const frame = `Rewrite this user message:\n${JSON.stringify(text)}`
  if (Buffer.byteLength(frame, 'utf8') > 32 * 1024) return undefined

  const controller = new AbortController()
  const abortParent = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abortParent, { once: true })
  }
  const timer = setTimeout(() => {
    controller.abort(new Error(`${REWRITE_TIMEOUT_CODE}: rewrite timed out`))
  }, config.timeoutMs)

  try {
    const options = Object.freeze({
      provider: route.provider,
      model: route.model,
      system: config.instruction,
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: frame }],
          source: { kind: 'plugin', plugin: REWRITE_SOURCE },
        }),
      ],
      maxTokens: config.maxOutputTokens,
      sessionId,
      purpose: 'question-rewrite',
      signal: controller.signal,
    })
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream(options)) {
      controller.signal.throwIfAborted()
      assembler.push(chunk)
    }
    controller.signal.throwIfAborted()
    if (assembler.finish.kind !== 'stop') return undefined
    if (assembler.blocks().some((block) => block.type === 'tool-call')) return undefined
    const result = assembler.blocks()
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(' ')
      .trim()
    return result.length > 0 ? result : undefined
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', abortParent)
  }
}

/** Required service (activated before this plugin) whose provider resolves
 * model routes; its `stream` method carries the auxiliary rewrite call. */
export const inject = ['llm']

/**
 * A Cordis plugin; registers the rewrite on the `agent/pre-step` waterfall.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {*} config - the loader-supplied `config` block.
 */
export function apply(ctx, config) {
  const resolved = validateConfig(config)

  // Diagnostic logging: append one line per pre-step pass so rewrite behaviour
  // (route resolution, output, fallback, errors) can be inspected live.
  // Defaults to $DSH_HOME/rewrite-question.log (usually ~/.dsh/...); override
  // with the DSH_REWRITE_LOG env var, or set it to '' to disable.
  const home = (typeof process !== 'undefined' && (process.env?.DSH_HOME || process.env?.HOME)) || '.'
  const envLog = typeof process !== 'undefined' ? process.env?.DSH_REWRITE_LOG : undefined
  const logPath = envLog === '' ? null : (envLog || `${home}/rewrite-question.log`)
  const log = (line) => {
    if (!logPath) return
    try { appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`) } catch { /* never break */ }
  }

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const ts = Date.now()
    if (!resolved.enabled) { log(`${ts} disabled -> passthrough`); return next() }
    if (!Array.isArray(messages) || messages.length === 0) { log(`${ts} no messages`); return next() }
    const route = resolveRoute(resolved, agent)
    if (route === NO_ROUTE) { log(`${ts} NO_ROUTE (session=${agent?.session?.id})`); return next() }
    const hasUserText = messages.some(
      (message) => message?.source?.kind === 'user' && isPlainTextContent(message.content),
    )
    if (!hasUserText) { log(`${ts} no user plain text (n=${messages.length}) -> passthrough`); return next() }
    log(`${ts} route=${route.provider}/${route.model} n=${messages.length}`)

    // Delegate first so later pre-step listeners (context assembly, hooks,
    // plan mode) get the normal decision, then rewrite on our returned list.
    const downstream = await next()
    if (downstream?.kind !== 'enter' || !Array.isArray(downstream.messages)) {
      log(`${ts} downstream.kind=${downstream?.kind} -> passthrough`)
      return downstream
    }

    const sessionId = agent.session?.id
    let changed = false
    const rewritten = []
    for (const message of downstream.messages) {
      const keep = message
      if (message?.source?.kind === 'user' && isPlainTextContent(message.content)) {
        const userText = plainText(message.content)
        if (userText.length > 0 && !userText.startsWith('/')) {
          try {
            const out = await rewriteUser(ctx, route, sessionId, userText, signal, resolved)
            log(`${ts} in[${userText.length}] out[${out?.length ?? 0}] same=${out === undefined || out === userText}`)
            if (out && out !== userText) {
              changed = true
              rewritten.push(createUserMessage({
                content: [{ type: 'text', text: out }],
                source: message.source,
              }))
              continue
            }
          } catch (error) {
            log(`${ts} ERROR ${String(error?.message ?? error)}`)
            try { ctx.session?.logger?.warn?.(`${REWRITE_SOURCE}: rewrite fell back to original (${String(error?.message ?? error)})`) }
            catch { /* logging must never break the turn */ }
          }
        }
      }
      rewritten.push(keep)
    }
    log(`${ts} end changed=${changed}`)
    return changed ? { kind: 'enter', messages: rewritten } : downstream
  })
}