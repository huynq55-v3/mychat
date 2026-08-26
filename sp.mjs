/**
 * sp — "system prompt" slash-command for DSH.
 *
 * Registers `/sp` so the user can inject a custom system prompt into the
 * current chat session:
 *
 *    /sp <text>   set (or replace) the session's custom system prompt
 *    /sp clear    clear it again (falls back to the default persona)
 *    /sp          show the currently-active custom prompt (or "none")
 *
 * The prompt is rendered as a dedicated system-prompt section that replaces
 * the deployment persona slot for that agent, so it reads exactly where a
 * supervisor's system prompt would. When unset, the original persona is left
 * untouched. Setting it is instant (no model call, no re-route).
 *
 * Runtime safety:
 *  - Per-agent state only: nothing is written to disk, the guest model route
 *    is untouched, and clearing restores the default prompt exactly.
 *  - If the override text contains no `{{variable}}` reference, nothing to
 *    interpolate; declared prompt variables in the text are resolved normally.
 *  - Malformed invocation (blank set with a stray flag), an absent agent, and
 *    an unavailable system-prompt seam all degrade to a friendly error text
 *    rather than throwing.
 *
 * Deployment:
 *  drop this file into a DSH profile directory (e.g. `~/.dsh/profiles/web/`)
 *  and reference it from that profile's hot-reloaded `cordis.patch.yml`:
 *
 *    - insert:
 *        - id: sp
 *          name: './sp.mjs'
 *          config:
 *            enabled: true
 *
 *  In-box packages resolve through the profile's flat `node_modules` fallback.
 */

import { PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt'

/** Command sub-words that clear the override. */
const CLEAR_WORDS = new Set(['clear', 'reset', 'off', 'none'])

/** Validate untrusted loader config and fill defaults. */
function validateConfig(input) {
  const src = typeof input === 'object' && input !== null ? input : {}
  return {
    enabled: src.enabled !== false,
    sectionName: typeof src.sectionName === 'string' && src.sectionName.length > 0
      ? src.sectionName
      : 'user:sp',
    // Order matching the default persona (0); a replace keeps its position.
    order: boundingValue(src.order, -10000, 10000, 0),
  }
}

/** Clamp an integer config value into a safe inclusive range with a default. */
function boundingValue(value, min, max, fallback) {
  if (!Number.isInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Required services (activated before this plugin): the command registry
 * mounts `/sp`; the system-prompt seam feeds the assembled sections. */
export const inject = ['commands']

/**
 * A Cordis plugin; registers `/sp` and the per-agent system-prompt override.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {*} config - the loader-supplied `config` block.
 */
export function apply(ctx, config) {
  const resolved = validateConfig(config)

  // Per-agent (session-id keyed) custom prompt overrides. A WeakMap would be
  // cleaner in theory but reassembly often crosses into freshly-constructed
  // agent handles; a plain string key keeps the override stable across turns.
  const overrides = new Map()

  // The command seam and the prompt assembly seam are both services that the
  // loader may or may not have mounted. Guard the command seam so a
  // providerless host degrades to a helpful error instead of crashing.
  const commands = ctx.commands

  if (commands && resolved.enabled) {
    commands.register({
      name: 'sp',
      description: 'Inject a custom system prompt into this session',
      input: { hint: '<text> | clear' },
      handler: (invocation) => {
        const agent = invocation.agent
        if (!agent) return { kind: 'error', text: 'No agent context for /sp.' }
        const key = agent.id
        const raw = invocation.rawInput ?? ''
        const input = raw.trim()

        // `/sp` alone: report the current override (or that there is none).
        if (input.length === 0) {
          const active = overrides.get(key)
          return active
            ? { kind: 'success', text: `Active custom system prompt:\n\n${active}` }
            : { kind: 'success', text: 'No custom system prompt set. Usage: /sp <text> | /sp clear' }
        }

        // `/sp clear` (and friends): remove the override.
        if (CLEAR_WORDS.has(input.toLowerCase()) || CLEAR_WORDS.has(input.split(/\s+/)[0].toLowerCase())) {
          const had = overrides.delete(key)
          if (had) ctx.emit('system-prompt/change')
          return {
            kind: 'success',
            text: had
              ? 'Custom system prompt cleared.'
              : 'No custom system prompt was set.',
          }
        }

        // `/sp <text>`: set (or replace) the override.
        overrides.set(key, input)
        ctx.emit('system-prompt/change')
        const preview = input.length > 120 ? `${input.slice(0, 117)}…` : input
        return { kind: 'success', text: `Custom system prompt set:\n\n${preview}` }
      },
    })
  }

  // Inject the override as a system-prompt section during assembly, scoped to
  // the agent that owns the session. When no override exists we simply pass
  // the assembly through untouched, so the default persona is never modified.
  ctx.on('system-prompt/assemble', (assembly, context, next) => {
    const agent = context.agent
    if (agent && overrides.has(agent.id)) {
      const text = overrides.get(agent.id)
      const sections = assembly.sections
      const personaIndex = sections.findIndex((s) => s.name === PERSONA_SECTION)
      if (personaIndex >= 0) {
        // Replace the persona in place to preserve its ordering and keep the
        // custom prompt exactly where the deployment persona would have sat.
        sections[personaIndex] = { name: PERSONA_SECTION, text }
      } else if (!sections.some((s) => s.name === resolved.sectionName)) {
        sections.push({ name: resolved.sectionName, order: resolved.order, text })
      }
    }
    return next()
  })
}