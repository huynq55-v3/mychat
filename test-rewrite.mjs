// Standalone functional test of the rewrite-question plugin handler.
const { apply } = await import('/home/huy/.dsh/profiles/web/rewrite-question.mjs')

const text = (t) => [{ type: 'text', text: t }]
const userMsg = { source: { kind: 'user' }, content: text('toi muon biet lam sao de viet 1 plugin') }
const userCommand = { source: { kind: 'user' }, content: text('/goal hi') }
const contextMsg = { source: { kind: 'plugin', plugin: 'context' }, content: text('CONTEXT SNAPSHOT') }
const REWRITTEN = 'I would like to know how to author a plugin.'

async function* streamOK() {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: REWRITTEN }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: REWRITTEN } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

let pass = 0, fail = 0
function assert(cond, name) {
  if (cond) { pass++; console.log('  ok -', name) } else { fail++; console.log('  FAIL -', name) }
}

function build(llm, config) {
  const handlers = {}
  const ctx = { on: (e, h) => { handlers[e] = h } , llm }
  apply(ctx, config)
  return { handlers }
}

async function run(llm, messages, next, config) {
  const { handlers } = build(llm, config ?? { enabled: true, maxOutputTokens: 512, timeoutMs: 30000 })
  const handler = handlers['agent/pre-step']
  if (!handler) throw new Error('no agent/pre-step handler registered')
  const agent = { options: { provider: 'deepseek', model: 'deepseek-chat' }, session: { id: 'session-1' } }
  return handler({ agent, messages, signal: undefined }, next)
}

// 1. rewrites user text; command + context preserved; source kept as user.
{
  const result = await run({ stream: streamOK }, [userMsg], async () => ({ kind: 'enter', messages: [userMsg, userCommand, contextMsg] }))
  assert(result.kind === 'enter', '1 enter decision')
  const [rw, cmd, ctxMsg] = result.messages
  assert(rw.content[0].text === REWRITTEN, '1 user text rewritten')
  assert(rw.content !== userMsg.content, '1 new message object')
  assert(rw.source.kind === 'user', '1 source stays user')
  assert(cmd.content[0].text === '/goal hi', '1 command untouched')
  assert(ctxMsg.content[0].text === 'CONTEXT SNAPSHOT', '1 context untouched')
}

// 2. LLM failure -> fall back to original message, still enter.
{
  const bad = { stream: async function* () { throw new Error('boom') } }
  const result = await run(bad, [userMsg], async () => ({ kind: 'enter', messages: [userMsg] }))
  assert(result.kind === 'enter' && result.messages[0] === userMsg, '2 keeps original on failure')
}

// 3. reject decision delegated unchanged.
{
  const result = await run(null, [userMsg], async () => ({ kind: 'reject' }))
  assert(result.kind === 'reject', '3 reject forwarded')
}

// 4. no user text in payload -> next() short circuit.
{
  const next = async () => ({ kind: 'enter', messages: [contextMsg] })
  const result = await run(null, [contextMsg], next)
  assert(result.messages[0] === contextMsg, '4 non-user payload delegates')
}

// 5. disabled plugin -> next()) unchanged.
{
  const result = await run(null, [userMsg], async () => ({ kind: 'enter', messages: [userMsg] }), { enabled: false })
  assert(result.messages[0] === userMsg, '5 disabled -> delegate unchanged')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)