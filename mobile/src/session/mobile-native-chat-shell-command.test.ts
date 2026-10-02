// A chat message that starts with `!` runs as a shell command on the desktop.
//
// Claude Code 2.1.287 (read from the binary, not typed live): `Yy(text)` is
// 'bash' when the text starts with "!", and a leading "!" arriving into an EMPTY
// input at cursor 0 switches the input to bash mode and strips it, whether it
// comes as one key, as a multi-character chunk (`gP`'s `db.length===0` branch)
// or as a paste (`Hv`). The phone empties the input first (verified clear) and
// then types the body as one raw write, so `!cmd` from the chat enters bash mode
// and Enter RUNS `cmd`, with no permission prompt. Codex 0.153.4 has the same
// door: its binary holds `Op::RunUserShellCommand`, `core/src/tasks/user_shell.rs`
// and a shortcuts overlay line "! for shell commands" (strings only, not run).
//
// The send trims the END only (`draftText.trimEnd()` in
// use-mobile-native-chat-message-send.ts), so a leading space reaches the agent
// and defeats the switch: the rule here is "starts with `!`", not "trimmed
// starts with `!`".

import { describe, expect, it } from 'vitest'
import { shellCommandOfSend } from './mobile-native-chat-shell-command'

describe('what a chat message runs as a shell command', () => {
  it.each([
    ['!ls -la', 'ls -la'],
    ['! git status', 'git status'],
    ['!!', '!'],
    ['!important: fix the build', 'important: fix the build'],
    ['!ls\nrm -rf build', 'ls\nrm -rf build']
  ])('reads %j as the command %j on a Claude tab', (text, command) => {
    expect(shellCommandOfSend(text, 'claude')).toBe(command)
  })

  it.each([
    ['plain words', 'fix the build'],
    ['a bang that is not first', 'fix the build!'],
    ['a leading space, which the agent keeps and which is no switch', ' !ls'],
    ['a leading newline', '\n!ls'],
    ['an empty message', '']
  ])('reads %s as no command', (_name, text) => {
    expect(shellCommandOfSend(text, 'claude')).toBeNull()
  })

  it('reads a bare `!` as a command with nothing in it', () => {
    expect(shellCommandOfSend('!', 'claude')).toBe('')
    expect(shellCommandOfSend('!   ', 'claude')).toBe('')
    expect(shellCommandOfSend('!\n', 'claude')).toBe('')
  })

  it('covers Codex, which has the same door (binary strings)', () => {
    expect(shellCommandOfSend('!ls', 'codex')).toBe('ls')
    expect(shellCommandOfSend('ls', 'codex')).toBeNull()
  })

  it('leaves an agent that is neither alone', () => {
    expect(shellCommandOfSend('!ls', 'omp')).toBeNull()
    expect(shellCommandOfSend('!ls', null)).toBeNull()
    expect(shellCommandOfSend('!ls', undefined)).toBeNull()
  })
})
