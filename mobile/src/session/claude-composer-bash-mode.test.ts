// Claude Code's `!` bash-mode input box, as readClaudeInput locates it.
//
// MODELLED, not captured: no live Claude on this desktop was in bash mode, and
// nothing was typed. The shape is read from the 2.1.287 binary: the prompt
// prefix is `qw({mode})`, `(mode === "bash" ? "!" : pointer) + Q9o` with
// `Q9o = "\xA0"`, in the colour `bashBorder` (a colour only: the box keeps its two
// rules). So the row is `!` and a no-break space where `❯` and a no-break space
// would be, and what the user typed follows it. (A leading `!` the user types
// into the empty input is stripped and shown only as this prefix.)
//
// Why locate it at all: a message the user confirmed to run as a shell command
// is typed into an empty input and switches it to bash mode
// (mobile-native-chat-shell-command.ts), so a read of the box after that must
// see a box with the command in it, not "no composer". A box that is ALREADY in
// bash mode when a send starts is still refused by the send's look
// (claudeComposerLive): typing `!cmd` into it would run `!cmd`, shell history
// expansion, not the command.

import { describe, expect, it } from 'vitest'
import { claudeComposerLive, readClaudeInput } from './claude-composer-screen'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'

const RULE = '─'.repeat(190)
const FOOTER = '  ! for bash mode'
const bashBox = (...rows: string[]): string[] => ['⏺ Done.', RULE, ...rows, RULE, FOOTER]

describe("reading Claude Code's input box in bash mode", () => {
  it('locates an empty bash box and says it is bash mode', () => {
    expect(readClaudeInput(bashBox('! '), '')).toEqual({
      located: true,
      mode: 'bash',
      text: '',
      rows: 1
    })
  })

  it('reads the command typed after the prefix', () => {
    expect(readClaudeInput(bashBox('! ls -la'), '')).toMatchObject({
      located: true,
      mode: 'bash',
      text: 'ls -la'
    })
  })

  it('reads the prefix with a plain space too, as a trimming reader leaves it', () => {
    expect(readClaudeInput(bashBox('! git status'), '')).toMatchObject({
      located: true,
      mode: 'bash',
      text: 'git status'
    })
  })

  it('reads a bare `!` row with nothing after it', () => {
    expect(readClaudeInput(bashBox('!'), '')).toMatchObject({ located: true, mode: 'bash', text: '' })
  })

  it('counts a command that wraps onto a second row', () => {
    const read = readClaudeInput(bashBox('! echo one two three', '  four five six'), '')
    expect(read).toMatchObject({ located: true, mode: 'bash', rows: 2 })
    expect(read.located && read.text).toBe('echo one two three\nfour five six')
  })

  it('does not mark an ordinary prompt box as bash mode', () => {
    expect(readClaudeInput(EMPTY_COMPOSER, '')).toEqual({ located: true, text: '', rows: 1 })
  })

  it('does not take a `!` row in the conversation for the box', () => {
    expect(readClaudeInput(['! ls', '⏺ ran it', RULE, '❯ ', RULE, FOOTER], '')).toEqual({
      located: true,
      text: '',
      rows: 1
    })
    expect(readClaudeInput(['⏺ ran', '! ls', '  out'], '')).toEqual({ located: false })
  })

  it('does not take a shell prompt that starts with `!` for the box (no rules around it)', () => {
    expect(readClaudeInput(['⏺ Done.', '! '], '')).toEqual({ located: false })
  })

  it('is not located on an empty screen, or a lone rule pair', () => {
    expect(readClaudeInput([], '')).toEqual({ located: false })
    expect(readClaudeInput([RULE, RULE], '')).toEqual({ located: false })
  })
})

describe('a send onto a screen already in bash mode', () => {
  it('is still refused: the box is up, but typing into it would not be a message', () => {
    expect(claudeComposerLive(bashBox('! '))).toBe(false)
    expect(claudeComposerLive(bashBox('! ls'))).toBe(false)
  })
})
