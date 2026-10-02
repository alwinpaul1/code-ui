// A `!` command the user ran reaches the chat as the surfaced turn `!cmd`
// (mobile-native-chat-shell-command-turns.ts), no longer as the `<bash-input>` envelope the vendored
// harness filter treats as machinery. The desk-prompt logic reads those same rows, and two of its rules
// are about who started a turn and which row is a dequeued prompt. DECIDED ON PURPOSE:
//  - a surfaced shell command is the user's own words, so it is NOT a harness message that starts a
//    run (placedByHarnessTurns): a prompt carried past a turn end whose next row is `!cmd` stays held,
//    which is the safe side (it refuses, never places wrongly), where the envelope used to count as
//    the harness's and place it;
//  - but it is still not a PROMPT the agent took, so a multi-line one is no "joined row" a desk
//    copy was dequeued into (joinedLineBetween): the row stays what it was, machinery to that rule,
//    or a command's own lines could drop a real desk prompt's bubble.

import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { placedByHarnessTurns } from './desk-prompt-harness-turns'
import { joinedLineBetween } from './desk-prompt-row-owners'
import { surfaceShellCommandTurns } from './mobile-native-chat-shell-command-turns'

const words = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')
const row = (id: string, role: 'user' | 'assistant', text: string, timestamp: number | null = 1): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text }],
  timestamp,
  source: 'transcript'
})
const none = new Map()
const surfaced = (id: string, command: string, timestamp: number | null = 1): NativeChatMessage =>
  surfaceShellCommandTurns([row(id, 'user', `<bash-input>${command}</bash-input>`, timestamp)])[0]!

describe('a surfaced `!` command and the desk prompt rules', () => {
  it('is not a joined row a desk copy was dequeued into, however many lines it has', () => {
    const between = [row('a1', 'assistant', 'one'), surfaced('u2', 'echo go on\ngo on'), row('u4', 'user', 'go on')]
    expect(joinedLineBetween(between, 0, 2, 'go on', words, none)).toBe(false)
    // The same lines as an ordinary prompt are one (the rule is unchanged for a person's words).
    const typed = [row('a1', 'assistant', 'one'), row('u2', 'user', 'go on\nand the rest'), row('u4', 'user', 'go on')]
    expect(joinedLineBetween(typed, 0, 2, 'go on', words, none)).toBe(true)
  })

  const at = 1_000_000
  const held: DesktopPrompt = {
    nonce: 'status:s:x:0',
    text: 'carry on',
    heldBack: true,
    ifHarnessStarted: { at, crossings: [{ after: at + 100, before: at + 200 }] },
    seenAt: 1
  }
  const teammate = row('t', 'user', 'Another Claude session sent a message:\n<teammate-message teammate_id="b">\n(r)\n</teammate-message>', at + 150)

  it('does not count as a harness message starting the run, so a held prompt stays held', () => {
    const list = [held]
    expect(placedByHarnessTurns(list, [surfaced('c', 'ls', at + 150)])).toBe(list)
    // A harness message there still places it, so the test is about the row and not the window.
    expect(placedByHarnessTurns(list, [teammate])[0]).not.toBe(held)
  })

  it('does not count either beside a harness message in the window: a person\'s words are there', () => {
    const list = [held]
    expect(placedByHarnessTurns(list, [teammate, surfaced('c', 'ls', at + 160)])).toBe(list)
  })
})
