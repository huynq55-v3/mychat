/**
 * Functional test for sp.mjs: exercise the /sp command handler and the
 * system-prompt/assemble hook against a mock Cordis context.
 */
import { apply } from './sp.mjs'

let failures = 0
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`)
  else { failures++; console.log(`FAIL  ${name} ${detail}`) }
}

// --- Mock context -----------------------------------------------------------
const overrides = new Map() // keyed by agent.id
const sections = [
  { name: 'harness:identity', order: -100, text: 'You are an AI agent.' },
  { name: 'deployment:persona', order: 0, text: 'Default persona.' },
  { name: 'tool:guidance', order: 100, text: 'Use tools.' },
]
const emitted = []
const registered = []
const ctx = {
  commands: {
    register(def) { registered.push(def) },
  },
  emit(name) { emitted.push(name) },
  on(name, handler) { if (name === 'system-prompt/assemble') this.assembleHook = handler },
}

apply(ctx, { enabled: true })

const [def] = registered
check('command registered as sp', def?.name === 'sp', JSON.stringify(def?.name))
check('command has description', typeof def?.description === 'string' && def.description.length > 0)
check('command has input hint', def?.input?.hint === '<text> | clear')

const agent = { id: 'agent-1' }
const invoke = (rawInput) => def.handler({ agent, rawInput, signal: new AbortController().signal })

// Assemble helper: fresh sections each time, run the hook.
async function assemble() {
  const assembly = { sections: sections.map(s => ({ ...s })) }
  const result = await ctx.assembleHook(assembly, { agent }, async () => assembly)
  return result
}

// --- /sp alone: no override -------------------------------------------------
const showEmpty = invoke('')
check('/sp shows none', showEmpty.kind === 'success' && /No custom system prompt/.test(showEmpty.text), showEmpty.text)

// --- /sp <text> -------------------------------------------------------------
const set1 = invoke('  Luon tra loi bang tieng Viet.  ')
check('/sp set returns success', set1.kind === 'success', JSON.stringify(set1))
check('/sp set echoes prompt', set1.text.includes('Luon tra loi bang tieng Viet.'), set1.text)

const a1 = await assemble()
const persona = a1.sections.find(s => s.name === 'deployment:persona')
check('assemble replaces persona text', persona?.text === 'Luon tra loi bang tieng Viet.', JSON.stringify(persona))
check('assemble keeps other sections', a1.sections.length === 3, `len=${a1.sections.length}`)
check('assemble keeps identity', a1.sections[0]?.name === 'harness:identity')
check('system-prompt/change emitted on set', emitted.includes('system-prompt/change'))

// Replace an existing override
const set2 = invoke('Answer in English always.')
check('/sp replace returns success', set2.kind === 'success')
const a2 = await assemble()
check('assemble uses new text', a2.sections.find(s => s.name === 'deployment:persona')?.text === 'Answer in English always.')

// --- /sp alone: with override ----------------------------------------------
const showSet = invoke('')
check('/sp shows active prompt', showSet.kind === 'success' && showSet.text.includes('Answer in English always.'), showSet.text)

// --- /sp clear --------------------------------------------------------------
const clear = invoke('clear')
check('/sp clear returns success', clear.kind === 'success' && /cleared/.test(clear.text), clear.text)
const a3 = await assemble()
check('assemble restores default persona', a3.sections.find(s => s.name === 'deployment:persona')?.text === 'Default persona.', JSON.stringify(a3.sections))

// --- Clear when nothing set -------------------------------------------------
const clear2 = invoke('clear')
check('/sp clear with none is friendly', clear2.kind === 'success' && /was set/.test(clear2.text), clear2.text)

// --- reset / off aliases ----------------------------------------------------
invoke('reset')
const a4 = await assemble()
check('reset clears override', a4.sections.find(s => s.name === 'deployment:persona')?.text === 'Default persona.')
invoke('set something')
invoke('off')
const a5 = await assemble()
check('off clears override', a5.sections.find(s => s.name === 'deployment:persona')?.text === 'Default persona.')

// --- No persona section in assembly (defensive push) ------------------------
invoke('set something')
const bare = { sections: [{ name: 'harness:identity', order: -100, text: 'id' }] }
const bareResult = await ctx.assembleHook(bare, { agent }, async () => bare)
check('assemble pushes new section when persona absent',
  bareResult.sections.some(s => s.name === 'user:sp' && s.text === 'set something'),
  JSON.stringify(bareResult.sections))

// --- Other agent untouched --------------------------------------------------
invoke('Prompt for agent one')
const other = { id: 'agent-2' }
const otherAssembly = { sections: [{ name: 'deployment:persona', order: 0, text: 'Default persona.' }] }
const otherResult = await ctx.assembleHook(otherAssembly, { agent: other }, async () => otherAssembly)
check('other agent keeps default persona', otherResult.sections[0]?.text === 'Default persona.')

// --- Disabled config --------------------------------------------------------
const disabledReg = []
const disabledCtx = {
  commands: { register(d) { disabledReg.push(d) } },
  emit() {},
  on() {},
}
apply(disabledCtx, { enabled: false })
check('disabled config does not register command', disabledReg.length === 0)

// --- No commands service ----------------------------------------------------
let threw = false
try {
  apply({ commands: undefined, emit() {}, on() {} }, {})
} catch (e) { threw = true }
check('no commands service does not throw', !threw)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
