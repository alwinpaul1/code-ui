import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'

// The Claude app's own words for a run of tool calls (Claude Android
// 1.261013.20, decompiled 2026-10-15): one plural per category of the enum
// `gqz` (Read, Edit, NotebookEdit, Write, Bash, Grep, Glob, Web, Todo, Task,
// ExitPlanMode, Other), chosen in `nw30.h`, worded in plurals.xml
// `ccr_summary_*`; a run of ONE call reads as verb + the call's own target
// (`hqz.c`, `xpz.a`), and at most three categories are named.

let n = 0
function call(name: string, input: Record<string, unknown> = {}): NativeChatBlock {
  n += 1
  return { type: 'tool-call', id: `c-${name}-${n}`, name, input }
}
function ok(): NativeChatBlock {
  return { type: 'tool-result', output: 'ok' }
}
function failed(): NativeChatBlock {
  return { type: 'tool-result', output: '<tool_use_error>no</tool_use_error>', isError: true }
}

describe('a run of tool calls reads in the Claude app words', () => {
  it('says "searched code" for Grep and "found files" for Glob, never a count of searches', () => {
    expect(toolRunSentence([call('Bash'), ok(), call('Grep'), ok(), call('Grep'), ok()])).toBe(
      'Ran a command, searched code'
    )
    expect(toolRunSentence([call('Bash'), ok(), call('Glob'), ok(), call('Glob'), ok()])).toBe(
      'Ran a command, found files'
    )
    expect(toolRunSentence([call('Grep'), ok(), call('Glob'), ok()])).toBe('Searched code, found files')
  })

  it('says "browsed the web" for WebFetch and WebSearch together', () => {
    expect(toolRunSentence([call('Bash'), ok(), call('WebFetch'), ok(), call('WebSearch'), ok()])).toBe(
      'Ran a command, browsed the web'
    )
  })

  it('says "updated todos" for TodoWrite, not "used a tool"', () => {
    expect(toolRunSentence([call('Bash'), ok(), call('TodoWrite'), ok(), call('TodoWrite'), ok()])).toBe(
      'Ran a command, updated todos'
    )
  })

  it('says "created a file" for every Write, beside edits of other files', () => {
    expect(
      toolRunSentence([call('Edit'), ok(), call('Write'), ok(), call('Write'), ok()])
    ).toBe('Edited a file, created 2 files')
  })

  it('says "edited a notebook" for NotebookEdit', () => {
    expect(toolRunSentence([call('Bash'), ok(), call('NotebookEdit'), ok()])).toBe('Ran a command, edited a notebook')
    expect(toolRunSentence([call('NotebookEdit'), ok(), call('NotebookEdit'), ok()])).toBe('Edited 2 notebooks')
  })

  it('says "ran an agent" for Agent and Task, "proposed a plan" for ExitPlanMode', () => {
    expect(toolRunSentence([call('Bash'), ok(), call('Agent'), ok(), call('Task'), ok()])).toBe(
      'Ran a command, ran 2 agents'
    )
    expect(toolRunSentence([call('Bash'), ok(), call('ExitPlanMode'), ok()])).toBe('Ran a command, proposed a plan')
  })

  it('files a Skill call and a SendMessage beside other work under "used a tool", as the app does', () => {
    expect(
      toolRunSentence([call('Bash'), ok(), call('Skill', { skill: 'unslop' }), ok(), call('SendMessage', { to: 'r' }), ok()])
    ).toBe('Ran a command, used 2 tools')
  })

  it('names no file beside other work: only a run of one call reads its target', () => {
    expect(toolRunSentence([call('Read', { file_path: '/r/a.ts' }), ok(), call('Bash'), ok()])).toBe(
      'Read a file, ran a command'
    )
  })

  it('names at most three categories, those with failures first, in run order', () => {
    const run = [
      call('Bash'), ok(),
      call('Read'), ok(),
      call('Grep'), ok(),
      call('Glob'), failed(),
      call('TodoWrite'), ok()
    ]
    expect(toolRunSentence(run)).toBe('Ran a command, read a file, found files (1 failed)')
  })

  it('names all three when there are exactly three, and one when there is one', () => {
    expect(toolRunSentence([call('Bash'), ok(), call('Read'), ok(), call('Grep'), ok()])).toBe(
      'Ran a command, read a file, searched code'
    )
    expect(toolRunSentence([call('Grep'), ok()])).toBe('Searched code')
  })
})

describe('a run of one call reads its own target, as the Claude app reads it', () => {
  it('names the file an Edit changed', () => {
    expect(toolRunSentence([call('Edit', { file_path: '/repo/src/parser.ts', old_string: 'a', new_string: 'b' }), ok()])).toBe(
      'Edited parser.ts'
    )
  })

  it('names the file a Write created, and an overwrite as an edit', () => {
    const created: NativeChatBlock = { type: 'tool-result', output: 'File created successfully at: /repo/NEW.md' }
    expect(toolRunSentence([call('Write', { file_path: '/repo/NEW.md', content: 'a\n' }), created])).toBe('Created NEW.md')
    expect(toolRunSentence([call('Write', { file_path: '/repo/old.md', content: 'a\n' }), ok()])).toBe('Edited old.md')
  })

  it('names the notebook a NotebookEdit changed', () => {
    expect(toolRunSentence([call('NotebookEdit', { notebook_path: '/repo/analysis.ipynb' }), ok()])).toBe(
      'Edited analysis.ipynb'
    )
  })

  it('names the pattern of a Grep or a Glob', () => {
    expect(toolRunSentence([call('Grep', { pattern: 'toolCallKind', path: '/repo' }), ok()])).toBe('Searched toolCallKind')
    expect(toolRunSentence([call('Glob', { pattern: '**/*.test.ts' }), ok()])).toBe('Searched **/*.test.ts')
  })

  it('names the skill a Skill call ran as /name', () => {
    expect(toolRunSentence([call('Skill', { skill: 'unslop' }), ok()])).toBe('Ran skill /unslop')
    expect(toolRunSentence([call('Skill', { skill: 'codex:rescue' }), ok()])).toBe('Ran skill /codex:rescue')
    expect(toolRunSentence([call('Skill', { skill: 'plugins/review' }), ok()])).toBe('Ran skill /review')
    expect(toolRunSentence([call('Skill', {}), ok()])).toBe('Ran skill')
  })

  it('names an agent by its description', () => {
    expect(toolRunSentence([call('Agent', { description: 'Review the diff', prompt: 'x' }), ok()])).toBe(
      'Ran agent Review the diff'
    )
    expect(toolRunSentence([call('Agent', {}), ok()])).toBe('Ran an agent')
  })

  it('names a task by its subject', () => {
    expect(toolRunSentence([call('TaskCreate', { subject: 'Fix the parser', description: 'x' }), ok()])).toBe(
      'Used TaskCreate Fix the parser'
    )
    expect(toolRunSentence([call('TaskUpdate', { taskId: '3', subject: 'Ship it' }), ok()])).toBe('Used TaskUpdate Ship it')
  })

  it('names a web search by its query and a fetch by its URL', () => {
    expect(toolRunSentence([call('WebSearch', { query: 'xterm.js C0 bytes' }), ok()])).toBe('Searched web xterm.js C0 bytes')
    expect(toolRunSentence([call('WebFetch', { url: 'https://example.com/a', prompt: 'x' }), ok()])).toBe(
      'Fetched https://example.com/a'
    )
  })

  it('names an undescribed Bash call by its command', () => {
    expect(toolRunSentence([call('Bash', { command: 'git   status\n --short' }), ok()])).toBe('Ran git status --short')
  })

  it('keeps the failure count after the target', () => {
    expect(toolRunSentence([call('Grep', { pattern: 'x' }), failed()])).toBe('Searched x (1 failed)')
  })

  it('falls back to the category words when the call names nothing', () => {
    expect(toolRunSentence([call('TodoWrite', { todos: [] }), ok()])).toBe('Updated todos')
    expect(toolRunSentence([call('Grep', {}), ok()])).toBe('Searched code')
    expect(toolRunSentence([call('Edit', {}), ok()])).toBe('Edited a file')
  })
})
