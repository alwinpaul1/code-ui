import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { runSheetRows, type RunSheetRow } from './mobile-native-chat-run-sheet-rows'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'

// The run's sentence reads in the Claude app's words since 3dfeb05ab, and the
// sheet a tap on it opens still said "Searched the web" and a bare skill name
// under it. The app's verbs for one call (Claude Android 1.261013.20,
// strings.xml `ccr_verb_*`; targets read by `xpz.a`): "Searched web <query>",
// "Ran skill /<name>" (after its last `/`), "Updated todos", "Proposed plan",
// "Asked <first question's header>", "Listed <path>", "Searched <pattern>",
// "Used TaskCreate <subject>". The same words the run sentence gives the call
// when it is a run of one.

const drawn = (row: RunSheetRow): string => (row.detail ? `${row.verb}  ${row.detail}` : row.verb)
const one = (name: string, input: unknown, output = 'ok'): NativeChatBlock[] => [
  { type: 'tool-call', name, input, state: 'completed' },
  { type: 'tool-result', output }
]
const rowOf = (name: string, input: unknown): string => drawn(runSheetRows(one(name, input), [])[0]!)

describe("a Claude run sheet's rows read in the Claude app's words", () => {
  it('says "Searched web" for a web search, not "Searched the web"', () => {
    expect(rowOf('WebSearch', { query: 'rn flashlist' })).toBe('Searched web  rn flashlist')
  })

  it('names a skill as "/name", after its last slash, not the bare name', () => {
    expect(rowOf('Skill', { skill: 'unslop' })).toBe('Ran skill  /unslop')
    expect(rowOf('Skill', { skill: 'plugin:code-review/code-review' })).toBe('Ran skill  /code-review')
  })

  it('says "Updated todos" and "Proposed plan", not "Used TodoWrite" or "Used ExitPlanMode"', () => {
    expect(rowOf('TodoWrite', { todos: [{ content: 'a', status: 'pending' }] })).toBe('Updated todos')
    expect(rowOf('ExitPlanMode', { plan: '# Plan' })).toBe('Proposed plan')
  })

  it("names a question by its first header, a listing by its path, a task by its subject", () => {
    expect(rowOf('AskUserQuestion', { questions: [{ header: 'Scope', question: 'Which?' }] })).toBe('Asked  Scope')
    expect(rowOf('LS', { path: '/repo/src' })).toBe('Listed  /repo/src')
    expect(rowOf('TaskCreate', { subject: 'Port the parser', description: 'x' })).toBe('Used TaskCreate  Port the parser')
  })

  it('names a search by its pattern', () => {
    expect(rowOf('Grep', { pattern: 'TODO', path: '/repo/src' })).toBe('Searched  TODO')
    expect(rowOf('Glob', { pattern: '**/*.ts' })).toBe('Searched  **/*.ts')
  })

  it('says for a run of one what the run sentence says, verb and target', () => {
    for (const [name, input] of [
      ['WebSearch', { query: 'rn flashlist' }],
      ['Skill', { skill: 'unslop' }],
      ['AskUserQuestion', { questions: [{ header: 'Scope' }] }],
      ['LS', { path: '/repo/src' }],
      ['ExitPlanMode', { plan: '# Plan' }]
    ] as const) {
      const row = runSheetRows(one(name, input), [])[0]!
      expect(row.detail ? `${row.verb} ${row.detail}` : row.verb).toBe(toolRunSentence(one(name, input)))
    }
  })

  // Degenerate inputs: nothing to name falls back to the verb alone.
  it('draws the verb alone when the call names nothing', () => {
    expect(rowOf('WebSearch', {})).toBe('Searched web')
    expect(rowOf('Skill', {})).toBe('Ran skill')
    expect(rowOf('AskUserQuestion', { questions: [] })).toBe('Asked')
    expect(rowOf('LS', {})).toBe('Listed')
  })
})

// Codex keeps its rows exactly as they were: none of its tools carry Claude
// Code's names, and the Claude app has never drawn a Codex session.
describe("a Codex run sheet's rows are unchanged", () => {
  it('keeps "Searched the web" for a Codex web search, and its other verbs', () => {
    expect(rowOf('web_search', { query: 'rn flashlist' })).toBe('Searched the web  rn flashlist')
    expect(rowOf('exec_command', { cmd: 'ls' })).toBe('Ran  ls')
    expect(rowOf('list_dir', { path: '/repo/src' })).toBe('Searched  /repo/src')
    expect(rowOf('update_plan', { plan: [{ step: 'a', status: 'pending' }] })).toBe('Used update_plan  plan')
  })
})

// Review of 7a24e2529: some lanes hand a call's input as a JSON string, which
// the per-key reads did not look into; and a target was drawn whole however
// long it was, where the generic label cuts at 80.
describe("the Claude rows' targets, from any input shape and at any length", () => {
  it('reads a web search and a listing whose input is a JSON string', () => {
    expect(rowOf('WebSearch', '{"query":"flashlist"}')).toBe('Searched web  flashlist')
    expect(rowOf('LS', '{"path":"/repo/src"}')).toBe('Listed  /repo/src')
  })

  it('cuts a 5000-character pattern to 80, ending in an ellipsis', () => {
    const row = runSheetRows(one('Grep', { pattern: 'x'.repeat(5000) }), [])[0]!
    expect(row.detail!.length).toBe(80)
    expect(row.detail!.endsWith('…')).toBe(true)
  })

  it('cuts a long query, path, header and subject the same way', () => {
    const long = 'y'.repeat(300)
    for (const [name, input] of [
      ['WebSearch', { query: long }],
      ['LS', { path: long }],
      ['AskUserQuestion', { questions: [{ header: long }] }],
      ['TaskCreate', { subject: long }]
    ] as const) {
      expect(runSheetRows(one(name, input), [])[0]!.detail!.length).toBe(80)
    }
  })

  it('leaves a target of exactly 80 whole', () => {
    expect(runSheetRows(one('Grep', { pattern: 'z'.repeat(80) }), [])[0]!.detail).toBe('z'.repeat(80))
  })

  it('names a skill whose id ends in a slash by its whole id, never a bare "/"', () => {
    expect(rowOf('Skill', { skill: 'plugin/' })).toBe('Ran skill  /plugin/')
  })
})
