import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { codexExecRole, createCodexPollFolder } from './codex-stdin-poll'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'
import { CODE_MODE_POLL, CODE_MODE_START } from './fixtures/codex-code-mode-exec-cells-0.153.4'

// A polled `npm test` still read "Ran N commands" when the model polled with just
// {session_id, yield_time_ms}: only `chars: ""` counted as a poll (review, 2026-09-30). Codex
// deserializes write_stdin into `struct WriteStdinArgs { session_id: i32, #[serde(default)] chars:
// String, … }` (codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs at rust-v0.153.4, the
// same on main), so an omitted `chars` IS an empty write: a poll. A `chars` that is not a string is
// not a poll, because serde rejects the call.

function call(name: string, input: unknown = {}): NativeChatBlock {
  return { type: 'tool-call', name, input }
}
function result(): NativeChatBlock {
  return { type: 'tool-result', output: '' }
}

describe('a Codex write_stdin poll that omits chars', () => {
  it('reads as a poll of its session, as a function call and as its JSON-string arguments', () => {
    expect(codexExecRole('write_stdin', '{"session_id":1234,"yield_time_ms":1000}')).toEqual({
      role: 'poll',
      session: 1234
    })
    expect(codexExecRole('write_stdin', { session_id: 1234, yield_time_ms: 1000 })).toEqual({
      role: 'poll',
      session: 1234
    })
  })

  it('reads as a poll in a code-mode exec cell (Codex 0.153.4 cell shape)', () => {
    expect(
      codexExecRole('exec', 'text(await tools.write_stdin({session_id: 7, yield_time_ms: 500}));')
    ).toEqual({
      role: 'poll',
      session: 7
    })
    expect(
      codexExecRole(
        'exec',
        'text(await tools.write_stdin({session_id:68964,yield_time_ms:1000}));\n'
      )
    ).toEqual({
      role: 'poll',
      session: 68964
    })
  })

  it('folds into the command the run started', () => {
    const fold = createCodexPollFolder()
    expect(fold('exec_command', { cmd: 'npm test' })).toBe(false)
    expect(fold('write_stdin', { session_id: 5, yield_time_ms: 500 })).toBe(true)
    expect(fold('write_stdin', '{"session_id":5,"yield_time_ms":30000}')).toBe(true)
  })

  it('reads a polled npm test as one command', () => {
    const blocks = [
      call('exec_command', { cmd: 'npm test' }),
      result(),
      call('write_stdin', { session_id: 5, yield_time_ms: 500 }),
      result(),
      call('write_stdin', JSON.stringify({ session_id: 5, yield_time_ms: 30000 })),
      result()
    ]
    expect(toolRunSentence(blocks)).toBe('Ran a command')
  })

  it('reads with no arguments at all as a poll whose session it cannot read', () => {
    // serde would reject a call with no session_id; it is still no new command's start, so it
    // takes the unreadable-session rule every other such poll does.
    expect(codexExecRole('write_stdin', {})).toEqual({ role: 'poll', session: null })
    expect(codexExecRole('write_stdin', '{}')).toEqual({ role: 'poll', session: null })
    expect(codexExecRole('exec', 'text(await tools.write_stdin({}));')).toEqual({
      role: 'poll',
      session: null
    })
  })
})

describe('a Codex write_stdin that types input stays a command of its own', () => {
  it('is no poll when chars holds real input, a keystroke or Ctrl-C', () => {
    expect(codexExecRole('write_stdin', { session_id: 5, chars: 'y' })).toBeNull()
    expect(codexExecRole('write_stdin', { session_id: 5, chars: '\u0003' })).toBeNull()
    expect(codexExecRole('write_stdin', '{"session_id":5,"chars":"\\u0003"}')).toBeNull()
    expect(
      codexExecRole('exec', 'text(await tools.write_stdin({session_id: 7, chars: "y"}));')
    ).toBeNull()
    expect(
      codexExecRole('exec', "text(await tools.write_stdin({session_id: 7, chars: '\\u0003'}));")
    ).toBeNull()
  })

  it('is no poll when chars is not a string, which serde would reject', () => {
    expect(codexExecRole('write_stdin', { session_id: 5, chars: 0 })).toBeNull()
    expect(codexExecRole('write_stdin', { session_id: 5, chars: null })).toBeNull()
    expect(codexExecRole('write_stdin', '{"session_id":5,"chars":["y"]}')).toBeNull()
    expect(
      codexExecRole('exec', 'text(await tools.write_stdin({session_id: 7, chars: input}));')
    ).toBeNull()
  })

  it('counts a typed answer to a running command as a second command', () => {
    const fold = createCodexPollFolder()
    expect(fold('exec_command', { cmd: 'npm init' })).toBe(false)
    expect(fold('write_stdin', { session_id: 5, chars: 'y' })).toBe(false)
  })

  it('reads arguments that do not parse as nothing', () => {
    expect(codexExecRole('write_stdin', 'not json')).toBeNull()
    expect(codexExecRole('write_stdin', '[]')).toBeNull()
    expect(codexExecRole('write_stdin', null)).toBeNull()
  })
})

// The code-mode cell reader matched the argument object as `{[^{}]*}`, so a
// brace anywhere in it (an awk program, a JSON body, a nested object) made
// the cell unreadable, and it looked for `chars:` and `session_id:` anywhere
// in the text, inside a string included (review, 2026-09-30).
describe('a code-mode cell with braces or nesting in its arguments', () => {
  const cell = (tool: string, args: string): string => `text(await tools.${tool}({${args}}));`

  it('reads an exec_command whose cmd or arguments hold braces as a start', () => {
    for (const args of [
      `cmd: "awk '{print $1}' big.log | sort"`,
      'cmd: "echo ${HOME}"',
      `cmd: "curl -d '{\\"a\\":1}' localhost"`,
      'cmd: "npm test", env: {CI: "1", nested: {deep: [1, {x: 2}]}}',
      "cmd: 'it\\'s {fine}'"
    ]) {
      expect(codexExecRole('exec', `${cell('exec_command', args)}\n`)).toEqual({ role: 'start' })
    }
  })

  it('reads chars and session_id from the top level of the object only', () => {
    // A chars inside a string or a nested object is not the call's own, so it
    // does not make a poll typed input.
    expect(
      codexExecRole('exec', cell('write_stdin', 'session_id: 7, note: "type chars: \\"y\\" later"'))
    ).toEqual({ role: 'poll', session: 7 })
    expect(codexExecRole('exec', cell('write_stdin', 'meta: {chars: "y"}, session_id: 7'))).toEqual({
      role: 'poll',
      session: 7
    })
    // Nor is a session id inside a string or a nested object the call's own.
    expect(
      codexExecRole('exec', cell('write_stdin', 'note: "x session_id: 9, y", session_id: 7'))
    ).toEqual({ role: 'poll', session: 7 })
    expect(codexExecRole('exec', cell('write_stdin', 'meta: {session_id: 9}'))).toEqual({
      role: 'poll',
      session: null
    })
    // The call's own chars still decides: real input is no poll, '' is one.
    expect(
      codexExecRole('exec', cell('write_stdin', 'meta: {chars: ""}, session_id: 7, chars: "y"'))
    ).toBeNull()
    expect(codexExecRole('exec', cell('write_stdin', "session_id: 7, chars: ''"))).toEqual({
      role: 'poll',
      session: 7
    })
  })

  it('reads nothing from a cell it cannot read whole', () => {
    // An unterminated string, and a brace left open.
    expect(codexExecRole('exec', `text(await tools.exec_command({cmd: "awk '{print $1}));`)).toBeNull()
    expect(codexExecRole('exec', 'text(await tools.exec_command({cmd: "a", env: {CI: "1"}));')).toBeNull()
    // Two calls in one cell.
    expect(
      codexExecRole('exec', `${cell('exec_command', 'cmd: "a"')} ${cell('exec_command', 'cmd: "b"')}`)
    ).toBeNull()
    expect(
      codexExecRole('exec', `${cell('exec_command', 'cmd: "{a}"')}\n${cell('write_stdin', 'session_id: 1')}`)
    ).toBeNull()
    // A second argument, or the wrapper left open.
    expect(codexExecRole('exec', 'text(await tools.exec_command({cmd: "a"}, {x: 1}));')).toBeNull()
    expect(codexExecRole('exec', 'text(await tools.exec_command({cmd: "a"});')).toBeNull()
    // A template literal that interpolates is code the reader does not run.
    expect(codexExecRole('exec', cell('exec_command', 'cmd: `echo ${dir}`'))).toBeNull()
    // A comment could hide anything.
    expect(codexExecRole('exec', cell('exec_command', 'cmd: "a" /* } */'))).toBeNull()
    // Keys that are not written out leave chars unknown: no poll.
    expect(codexExecRole('exec', cell('write_stdin', 'session_id: 7, chars'))).toBeNull()
    expect(codexExecRole('exec', cell('write_stdin', 'session_id: 7, ...opts'))).toBeNull()
    // Empty and blank cells.
    expect(codexExecRole('exec', '')).toBeNull()
    expect(codexExecRole('exec', '   \n')).toBeNull()
  })

  it('still reads the cells Codex 0.153.4 wrote, and a bare awaited call', () => {
    expect(codexExecRole('exec', CODE_MODE_START)).toEqual({ role: 'start' })
    expect(codexExecRole('exec', CODE_MODE_POLL(1000))).toEqual({ role: 'poll', session: 68964 })
    expect(codexExecRole('exec', 'await tools.write_stdin({session_id: 3})')).toEqual({
      role: 'poll',
      session: 3
    })
  })
})
