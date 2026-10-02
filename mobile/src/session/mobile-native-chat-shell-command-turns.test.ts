// A `!` command the user ran is the user's turn, and the chat draws it as one.
//
// Claude Code writes it as a plain user turn, `<bash-input>cmd</bash-input>`, and its output as
// the next one, `<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>` (136 commands, Claude
// Code 2.1.228 to 2.1.282, verbatim in shape: mobile-native-chat-created-file-user-commands.test.ts;
// Claude's own history draws it as `! cmd`, binary 2.1.287). Orca's noise filter (vendored) hides
// every harness tag, so a command the phone just ran, and asked about first, was in the chat
// nowhere: the send said "Delivery unconfirmed — check chat" about a chat that could not show it.
// Only the `<bash-input>` turn is drawn. Its output turn stays hidden: drawing it needs a block
// the chat has no bubble for, and a bubble with the output in it would no longer match the text
// the phone sent, so the phone's own copy of the send would draw twice.

import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { surfaceShellCommandTurns } from './mobile-native-chat-shell-command-turns'

const turn = (id: string, role: 'user' | 'assistant', text: string): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text }],
  timestamp: null,
  source: 'transcript'
})
const textOf = (message: NativeChatMessage): string =>
  message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

describe('a shell command in the transcript', () => {
  it('is surfaced as the user turn the phone sent: `!` and the command as stored', () => {
    const out = surfaceShellCommandTurns([turn('u', 'user', '<bash-input>ls -la</bash-input>')])
    expect(out.map(textOf)).toEqual(['!ls -la'])
    expect(out[0]).toMatchObject({ id: 'u', role: 'user' })
  })

  it('keeps a space the user typed after the `!`, so the words match what was sent', () => {
    const out = surfaceShellCommandTurns([turn('u', 'user', '<bash-input> git status</bash-input>')])
    expect(out.map(textOf)).toEqual(['! git status'])
  })

  it('keeps a multi-line command whole', () => {
    const out = surfaceShellCommandTurns([turn('u', 'user', '<bash-input>echo a\necho b</bash-input>')])
    expect(out.map(textOf)).toEqual(['!echo a\necho b'])
  })

  it('leaves its output turn, an empty command, other harness tags and assistant rows alone', () => {
    const rows = [
      turn('o', 'user', '<bash-stdout>x</bash-stdout><bash-stderr></bash-stderr>'),
      turn('e', 'user', '<bash-input></bash-input>'),
      turn('r', 'user', '<system-reminder>x</system-reminder>'),
      turn('a', 'assistant', '<bash-input>ls</bash-input>'),
      turn('q', 'user', 'run <bash-input>ls</bash-input> for me')
    ]
    expect(surfaceShellCommandTurns(rows)).toEqual(rows)
  })

  it('returns the same list when nothing is surfaced, and handles none', () => {
    const rows = [turn('u', 'user', 'hello')]
    expect(surfaceShellCommandTurns(rows)).toBe(rows)
    expect(surfaceShellCommandTurns([])).toEqual([])
  })
})

describe('the chat the phone draws', () => {
  const rows = [
    turn('a', 'assistant', 'Done.'),
    turn('c', 'user', '<bash-input>ls -la</bash-input>'),
    turn('o', 'user', '<bash-stdout>file</bash-stdout><bash-stderr></bash-stderr>'),
    turn('z', 'assistant', 'Anything else?')
  ]

  it('shows the command, and still hides the output turn', () => {
    const folded = foldMobileNativeChatMessages(rows)
    expect(folded.filter((message) => message.role === 'user').map(textOf)).toEqual(['!ls -la'])
    expect(folded.map((message) => message.id)).not.toContain('o')
  })
})
