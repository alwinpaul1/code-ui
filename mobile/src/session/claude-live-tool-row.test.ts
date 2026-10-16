import { describe, expect, it } from 'vitest'
import type { NativeChatBlock, NativeChatMessage, NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import { CLAUDE_LIVE_TOOL_ROW_ENABLED, claudeLiveToolCall, claudeLiveToolClock } from './claude-live-tool-row'
import { claudeLiveToolLabel, claudeToolIsPathLike } from './claude-live-tool-label'
import {
  BASH_CALL_UUID,
  BASH_MOVED_UUID,
  RUNNING_ROWS_SHELL_DESCRIPTION,
  runningRowsMessages
} from './fixtures/claude-running-rows-2.1.296'

// The Claude app's live tool row (com.anthropic.claude 1.261013.20; every rule's decompile line is in
// claude-live-tool-row.ts, claude-live-tool-label.ts and claude-live-tool-send-message.ts). The transcript cases run on the lead transcript of Claude Code 2.1.296
// that the user screen-recorded on 2026-10-11 (fixtures/claude-running-rows-2.1.296.ts): a background
// Agent launch, a line of text, then a foreground Bash ten minutes unanswered.

let id = 0
function message(role: NativeChatMessage['role'], blocks: NativeChatBlock[], timestamp: number | null = null): NativeChatMessage {
  id += 1
  return { id: `m${id}`, role, blocks, timestamp, source: 'transcript' } as NativeChatMessage
}
function call(name: string, input: unknown, callId?: string): NativeChatToolCallBlock {
  return { type: 'tool-call', name, input, ...(callId ? { callId } : {}) }
}
const prompt = (at: number | null = 1_000) => message('user', [{ type: 'text', text: 'go' }], at)
const label = (name: string, input: unknown) => claudeLiveToolLabel(call(name, input))

describe('which call the live tool row names', () => {
  it('names the 2.1.296 transcript\'s unanswered Bash by its description, as its command is long', () => {
    const live = claudeLiveToolCall(runningRowsMessages(BASH_CALL_UUID))
    expect(live?.running).toBe(true)
    expect(live?.pair.call.name).toBe('Bash')
    expect(live?.pair.result).toBeUndefined()
    expect(claudeLiveToolLabel(live!.pair.call)).toBe(`Running ${RUNNING_ROWS_SHELL_DESCRIPTION}`)
  })

  it('names nothing once that Bash was moved to the background: it started background work', () => {
    expect(claudeLiveToolCall(runningRowsMessages(BASH_MOVED_UUID))).toBeNull()
  })

  it('names nothing for a background Agent launch that has answered ("Async agent launched")', () => {
    expect(claudeLiveToolCall(runningRowsMessages('7697cafe'))).toBeNull()
  })

  it('names nothing in a transcript with no tool calls, or none at all', () => {
    expect(claudeLiveToolCall([])).toBeNull()
    expect(claudeLiveToolCall([prompt()])).toBeNull()
    expect(claudeLiveToolCall([prompt(), message('assistant', [{ type: 'text', text: 'Hello.' }])])).toBeNull()
  })

  it('names the one running call of a turn that has made one call', () => {
    const live = claudeLiveToolCall([prompt(5_000), message('assistant', [call('Read', { file_path: '/a/b/c.ts' }, 'toolu_1')])])
    expect(live).toEqual({ pair: { call: call('Read', { file_path: '/a/b/c.ts' }, 'toolu_1') }, running: true, promptAt: 5_000 })
  })

  it('keeps naming a call that has its result while nothing is drawn after it (the app\'s Held)', () => {
    const read = call('Read', { file_path: '/a/b/c.ts' }, 'toolu_1')
    const live = claudeLiveToolCall([
      prompt(),
      message('assistant', [read]),
      message('tool', [{ type: 'tool-result', output: '1\tx', callId: 'toolu_1' }])
    ])
    expect(live?.running).toBe(false)
    expect(live?.pair.call).toBe(read)
    expect(live?.pair.result?.output).toBe('1\tx')
  })

  it('names nothing once the agent wrote text after its last call', () => {
    expect(
      claudeLiveToolCall([
        prompt(),
        message('assistant', [call('Read', { file_path: 'c.ts' }, 'toolu_1')]),
        message('tool', [{ type: 'tool-result', output: 'x', callId: 'toolu_1' }]),
        message('assistant', [{ type: 'text', text: 'Read it.' }])
      ])
    ).toBeNull()
  })

  it('pairs an Orca row\'s result, which carries no callId, with its call', () => {
    const live = claudeLiveToolCall([
      prompt(),
      message('assistant', [call('Read', { file_path: 'a.ts' }, 'toolu_1')]),
      message('tool', [{ type: 'tool-result', output: 'x' }]),
      message('assistant', [call('Grep', { pattern: 'foo' }, 'toolu_2')])
    ])
    expect(live?.running).toBe(true)
    expect(live?.pair.call.name).toBe('Grep')
  })

  it('names the newest running call of the group, not a finished one after it', () => {
    const live = claudeLiveToolCall([
      prompt(),
      message('assistant', [call('Bash', { command: 'sleep 9' }, 'a'), call('Read', { file_path: 'x.ts' }, 'b')]),
      message('tool', [{ type: 'tool-result', output: 'x', callId: 'b' }])
    ])
    expect(live?.running).toBe(true)
    expect(live?.pair.call.name).toBe('Bash')
  })

  it('passes over a Bash asked to run in the background, written as the text "true" as 2.1.296 writes it', () => {
    expect(
      claudeLiveToolCall([prompt(), message('assistant', [call('Bash', { command: 'sleep 99', run_in_background: 'true' }, 'a')])])
    ).toBeNull()
  })

  it('reads only the open turn: an earlier turn\'s call is not named', () => {
    expect(
      claudeLiveToolCall([message('assistant', [call('Read', { file_path: 'x.ts' }, 'a')]), prompt()])
    ).toBeNull()
  })
})

describe('the live tool row\'s label, in the app\'s present-tense words', () => {
  it('reads a short Bash command whole', () => {
    expect(label('Bash', { command: 'ls -la', description: 'List files' })).toBe('Running ls -la')
  })

  it('reads a command with a newline or over 60 characters by its description', () => {
    expect(label('Bash', { command: 'echo a\necho b', description: 'Echo twice' })).toBe('Running Echo twice')
    expect(label('Bash', { command: 'x'.repeat(61), description: 'Long one' })).toBe('Running Long one')
    expect(label('Bash', { command: 'x'.repeat(60), description: 'Long one' })).toBe(`Running ${'x'.repeat(60)}`)
  })

  it('keeps a long command when it has no description', () => {
    expect(label('Bash', { command: 'echo a\necho b' })).toBe('Running echo a\necho b')
  })

  it('names a file tool by its file name and cuts its label in the middle', () => {
    expect(label('Read', { file_path: '/Users/me/src/session/claude-live-tool-row.ts' })).toBe('Reading claude-live-tool-row.ts')
    expect(label('Edit', { file_path: 'C:\\code\\app.tsx' })).toBe('Editing app.tsx')
    expect(label('NotebookEdit', { notebook_path: '/n/book.ipynb' })).toBe('Editing book.ipynb')
    expect(label('Write', { file_path: '/a/new.ts' })).toBe('Creating new.ts')
    expect(claudeToolIsPathLike('Read')).toBe(true)
    expect(claudeToolIsPathLike('MultiEdit')).toBe(true)
    expect(claudeToolIsPathLike('Bash')).toBe(false)
    expect(claudeToolIsPathLike('Grep')).toBe(false)
  })

  it('reads a Write that replaced its file as "Editing", by its result', () => {
    expect(
      claudeLiveToolLabel(call('Write', { file_path: '/a/old.ts' }), {
        type: 'tool-result',
        output: 'The file /a/old.ts has been updated successfully.'
      })
    ).toBe('Editing old.ts')
  })

  it('reads search, web, agent and todo tools', () => {
    expect(label('Grep', { pattern: 'useTheme' })).toBe('Searching useTheme')
    expect(label('Glob', { pattern: '**/*.ts' })).toBe('Searching **/*.ts')
    expect(label('WebFetch', { url: 'https://example.com' })).toBe('Fetching https://example.com')
    expect(label('WebSearch', { query: 'react native' })).toBe('Searching web react native')
    expect(label('Agent', { description: 'Fix status line usage figures' })).toBe('Running agent Fix status line usage figures')
    expect(label('TodoWrite', { todos: [] })).toBe('Updating todos')
    expect(label('TaskCreate', { subject: 'Ship it' })).toBe('Updating todos Ship it')
    expect(label('ExitPlanMode', { plan: 'x' })).toBe('Proposing plan')
  })

  it('reads the named tools with no detail', () => {
    expect(label('Skill', { skill: 'tdd' })).toBe('Running skill')
    expect(label('LS', { path: '/a' })).toBe('Listing')
    expect(label('ToolSearch', { query: 'x' })).toBe('Loading tools')
    expect(label('Monitor', { command: 'tail' })).toBe('Watching background command')
    expect(label('EnterPlanMode', {})).toBe('Entering plan mode')
    expect(label('AskUserQuestion', { questions: [{ header: 'Pick' }] })).toBe('Asking')
    expect(label('SendUserMessage', { message: 'hi' })).toBe('Sending')
  })

  it('reads any other tool as "Using" its name, an MCP tool as "server: tool"', () => {
    expect(label('mcp__github__create_issue', { title: 'x' })).toBe('Using github: create issue')
    expect(label('mcp__hearthbot__send_note', {})).toBe('Using send note')
    expect(label('ListAgents', {})).toBe('Using ListAgents')
  })

  it('reads SendMessage by whom it goes to, with its summary', () => {
    expect(label('SendMessage', { to: 'lead', summary: 'Tests  pass' })).toBe('Messaging @lead Tests pass')
    expect(label('SendMessage', { to: 'abc123xyz', message: 'done' })).toBe('Messaging agent done')
    expect(label('SendMessage', { to: 'uds:/tmp/x.sock', message: 'hi' })).toBe('Messaging another session')
    expect(label('SendMessage', { message: 'hi' })).toBe('Messaging teammate hi')
    expect(label('SendMessage', { to: 'lead', message: { type: 'plan_approval_response', approve: true } })).toBe(
      'Approving plan from @lead'
    )
    expect(label('SendMessage', { to: 'w1', message: { type: 'shutdown_request', reason: 'Done' } })).toBe(
      'Asking @w1 to shut down Done'
    )
    expect(label('SendMessage', { to: 'lead', summary: 'y'.repeat(90) })).toBe(`Messaging @lead ${'y'.repeat(79)}…`)
  })

  it('reads the verb alone when the inputs are missing or not an object', () => {
    expect(label('Read', {})).toBe('Reading')
    expect(label('Read', null)).toBe('Reading')
    expect(label('Bash', 'ls')).toBe('Running')
    // A blank command is no `xpz.h` command, but `xpz.a` then reads it raw: the app appends it as is.
    expect(label('Bash', { command: '   ' })).toBe('Running    ')
    expect(label('Grep', { pattern: 42 })).toBe('Searching 42')
    expect(label('Agent', undefined)).toBe('Running agent')
  })
})

describe('the live tool row\'s clock', () => {
  const start = 1_000_000
  it('shows no time under 2 s, and none with no turn start', () => {
    expect(claudeLiveToolClock(start, start)).toBeNull()
    expect(claudeLiveToolClock(start, start + 1_999)).toBeNull()
    expect(claudeLiveToolClock(null, start + 50_000)).toBeNull()
    expect(claudeLiveToolClock(start, start - 5_000)).toBeNull()
  })

  it('shows whole seconds from 2 s, and minutes from one', () => {
    expect(claudeLiveToolClock(start, start + 2_000)).toBe('2s')
    expect(claudeLiveToolClock(start, start + 59_999)).toBe('59s')
    expect(claudeLiveToolClock(start, start + 65_400)).toBe('1m 5s')
  })
})

describe('the live tool row\'s flag', () => {
  it('is off: the user\'s Claude app drew the verb form while the Agent tool ran (2026-10-16)', () => {
    expect(CLAUDE_LIVE_TOOL_ROW_ENABLED).toBe(false)
  })
})
