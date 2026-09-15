import { describe, expect, it } from 'vitest'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// Reported 2026-09-15 with a screenshot and the word "leaked": a user bubble
// containing the AGENT'S reply, ending in the agent's own "session:ok".
//
// The screen reader glued the reply onto the prompt — two-space rows of ordinary
// prose are shaped exactly like a wrapped prompt, and nothing on the screen
// tells them apart. The glued text then matched no transcript row, so the echo
// could never retire and the agent's words stayed attributed to the user.
//
// The real row, read from the live transcript
// (.claude-work/…/63b835a8…jsonl, Claude Code 2.1.272), is exactly:
const REAL_ROW = '1050 is daimler thingy'
const GLUED =
  "1050 is daimler thingy I can't confirm it from here: distinguishing the two needs the raw " +
  'battery_power_kw series from ev_oem_telemetry. session:ok'

function message(id: string, role: 'user' | 'assistant', text: string): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' } as NativeChatMessage
}

function echo(text: string): MobileNativeChatPendingMessage {
  return {
    id: 'absorbed-1',
    text,
    draftKey: 'd',
    draftEditGeneration: 0,
    pendingKey: 'k',
    normalizedText: text,
    baselineOccurrences: 0,
    expectedOccurrence: 1,
    baselineTailMessageId: 'm0',
    baselineResolved: true
  } as MobileNativeChatPendingMessage
}

describe('a witnessed echo with the agent’s words glued on', () => {
  const messages = [message('m0', 'assistant', 'earlier'), message('m1', 'user', REAL_ROW)]

  it('retires against the prompt it was built from', () => {
    expect(retireLandedMobileNativeChatPending(messages, [echo(GLUED)], new Set())).toEqual([])
  })

  it('keeps an echo no row begins', () => {
    const other = [message('m0', 'assistant', 'x'), message('m1', 'user', 'a different message')]
    expect(retireLandedMobileNativeChatPending(other, [echo(GLUED)], new Set())).toHaveLength(1)
  })

  it('does not retire a genuinely longer message the user really sent', () => {
    // The user's own second sentence must not be mistaken for glue: the row has
    // to be a prefix AND the echo has to carry a whole extra sentence beyond it.
    // This is the honest limit, pinned so it is a decision.
    const rows = [message('m0', 'assistant', 'x'), message('m1', 'user', 'fix the parser')]
    expect(
      retireLandedMobileNativeChatPending(rows, [echo('fix the parser please')], new Set())
    ).toHaveLength(1)
  })

  it('leaves an exact echo to the exact-match pass', () => {
    const rows = [message('m0', 'assistant', 'x'), message('m1', 'user', 'exactly this')]
    expect(
      retireLandedMobileNativeChatPending(rows, [echo('exactly this')], new Set())
    ).toEqual([])
  })

  it('reads an empty transcript without retiring anything', () => {
    expect(retireLandedMobileNativeChatPending([], [echo(GLUED)], new Set())).toHaveLength(1)
  })
})
