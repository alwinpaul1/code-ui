import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { placedByHarnessTurns } from './desk-prompt-harness-turns'

// Session 76ba8f2f (Claude Code 2.1.283): "lets ask mahdi later u continue
// the work" was carried on the tab status past three turn ends, each next turn
// started by a teammate's message, a user row Orca publishes. Stamps are the
// transcript's (UTC); the crossings are those Orca's history gives.
const T = (clock: string) => Date.parse(`2026-09-26T${clock}Z`)
const PROMPT = 'lets ask mahdi later u continue the work'
const row = (id: string, text: string, clock: string): NativeChatMessage => ({
  id,
  role: 'user',
  blocks: [{ type: 'text', text }],
  timestamp: T(clock),
  source: 'transcript'
})
const teammate = (id: string, name: string, clock: string) =>
  row(id, `Another Claude session sent a message:\n<teammate-message teammate_id="${name}" color="pink" summary="report">\n(report)\n</teammate-message>`, clock)
const held: DesktopPrompt = {
  nonce: 'status:76ba8f2f:x:0',
  text: PROMPT,
  heldBack: true,
  ifHarnessStarted: {
    at: T('13:20:44.026'),
    crossings: [
      { after: T('13:22:30.957'), before: T('13:46:47.262') },
      { after: T('13:48:06.768'), before: T('13:48:06.780') },
      { after: T('13:48:12.723'), before: T('14:27:03.037') }
    ]
  },
  seenAt: 1
}
const starts = [
  teammate('db838d66', 'builder-select', '13:46:47.262'),
  teammate('9bde0d61', 'builder-select', '13:48:06.780'),
  teammate('6d89d3e9', 'writer-bridge', '14:27:03.037')
]

describe('a desk prompt the tab status carried past turn ends', () => {
  it('goes to the run it came in when a harness message started every turn after', () => {
    expect(placedByHarnessTurns([held], starts)).toEqual([
      { nonce: held.nonce, text: PROMPT, at: T('13:20:44.026'), atStateStart: true, seenAt: 1 }
    ])
  })

  it('stays held while the row that started one of those turns is on a page not loaded', () => {
    const list = [held]
    expect(placedByHarnessTurns(list, starts.slice(2))).toBe(list)
  })

  it('stays held when a person’s words started the turn after: the same words may have been sent again', () => {
    const resent = [...starts.slice(0, 2), row('p1', PROMPT, '14:27:02.900'), starts[2]!]
    expect(placedByHarnessTurns([held], resent)[0]).toBe(held)
  })

  it('stays held with no rows at all, and leaves a copy with no hint alone', () => {
    const plain: DesktopPrompt = { nonce: 'status:s:1:0', text: 'hello', at: 1 }
    const list = [held, plain]
    expect(placedByHarnessTurns(list, [])).toBe(list)
    expect(placedByHarnessTurns([], starts)).toEqual([])
  })
})
