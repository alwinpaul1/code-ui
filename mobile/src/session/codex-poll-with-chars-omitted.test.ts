import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { codexExecRole, createCodexPollFolder } from './codex-stdin-poll'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'

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
