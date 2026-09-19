// Orca #21086 (533b0bd02), pinned where the gate runs it: the shared turn-status
// and turn-timing tests are vendored but never collected here.
//
// The symptom, measured on a real Claude session: the live indicator switched on
// at the send but anchored its clock at the provider turn-open, so it climbed to
// "Working for 25s", reset to "Working for 0s" when the turn opened, and settled
// "Worked for 26s" — three readings of one turn from two instants. One origin
// now serves both: the send that opened the turn (`requestedAt`) when the host
// named one, the provider turn-open otherwise, and a live clock never moves
// later while a turn holds.

import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import { agentJournalTurnBody } from '../../../src/shared/agent-session-turn-record'
import {
  reduceNativeChatTurnTiming,
  selectNativeChatTurnStatuses
} from '../../../src/shared/native-chat-turn-status'
import {
  selectStructuredAgentRunningTurnTiming,
  selectStructuredAgentSettledTurns,
  structuredAgentTurnLocalStartedAt
} from '../../../src/shared/structured-agent-session-turn-timing'
import { stepStructuredAgentTurnClock } from '../../../src/shared/structured-agent-turn-clock-anchor'

function item(
  itemId: string,
  sequence: number,
  body: AgentJournalRenderItem['body'],
  observedAt = sequence
): AgentJournalRenderItem {
  return { itemId, revision: 1, sequence, observedAt, body }
}

function user(itemId: string, sequence: number): AgentJournalRenderItem {
  return item(itemId, sequence, {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: itemId }]
  })
}

const validTurnKeys = new Set(['u1'])

describe('a turn counts from the send that opened it', () => {
  it('settles to the host interval from the request, not the provider turn-open', () => {
    // Sent at 1s, provider opened the turn at 8s (dispatch latency), ended at 27s.
    const items = [
      user('u1', 1),
      item(
        'turn-t1',
        2,
        agentJournalTurnBody({
          turnId: 't1',
          state: 'completed',
          requestedAt: 1_000,
          startedAt: 8_000,
          completedAt: 27_000,
          // The provider's own measure begins at turn-open; exact host endpoints win.
          durationMs: 19_000
        })
      )
    ]
    expect([...selectStructuredAgentSettledTurns(items)]).toEqual([
      ['u1', { startedAt: 8_000, workedSeconds: 26 }]
    ])
  })

  it('anchors the live counter on the request too, so it does not jump back at turn-open', () => {
    const running = selectStructuredAgentRunningTurnTiming(
      [
        user('u1', 1),
        item(
          'turn-t1',
          2,
          agentJournalTurnBody({
            turnId: 't1',
            state: 'running',
            requestedAt: 1_000,
            startedAt: 8_000
          }),
          8_100
        )
      ],
      't1'
    )
    expect(running?.requestedAt).toBe(1_000)
    // First seen locally at 50s on a host clock reading 26s: 25s in, counted from the send.
    expect(structuredAgentTurnLocalStartedAt(running!, 50_000, 26_000)).toBe(25_000)
  })

  it('keeps one host-to-local conversion per turn, so a later frame cannot move the anchor later', () => {
    const timing = selectStructuredAgentRunningTurnTiming(
      [
        user('u1', 1),
        item(
          'turn-t1',
          2,
          agentJournalTurnBody({ turnId: 't1', state: 'running', startedAt: 8_000 }),
          8_100
        )
      ],
      't1'
    )
    let now = 50_000
    const first = stepStructuredAgentTurnClock({
      timing,
      turnId: 't1',
      now: () => now,
      hostClock: { hostNow: 26_000, receivedAt: 49_000 },
      latch: null
    })
    expect(first.workingStartedAt).toBe(50_000 - 19_000)
    // A later, jittered host sample and a later render: same latch, same anchor.
    now = 60_000
    const again = stepStructuredAgentTurnClock({
      timing,
      turnId: 't1',
      now: () => now,
      hostClock: { hostNow: 37_500, receivedAt: 59_000 },
      latch: first.latch
    })
    expect(again.latch).toBe(first.latch)
    expect(again.workingStartedAt).toBe(first.workingStartedAt)
    // The turn ending releases the latch.
    expect(
      stepStructuredAgentTurnClock({ timing: null, turnId: null, now: () => now, hostClock: null, latch: again.latch })
    ).toEqual({ latch: null, workingStartedAt: null })
  })

  it('never runs the live clock backwards when the lifecycle row lands before its origin', () => {
    const optimistic = reduceNativeChatTurnTiming(
      {},
      { activeTurnKey: 'u1', validTurnKeys, isWorking: true, now: 1_000 }
    )
    // The turn-open row says 8s; the send at 1s is the earlier anchor and holds.
    const turnStarted = reduceNativeChatTurnTiming(optimistic, {
      activeTurnKey: 'u1',
      validTurnKeys,
      isWorking: true,
      workingStartedAt: 8_000,
      now: 8_000
    })
    expect(turnStarted).toBe(optimistic)
    expect(
      selectNativeChatTurnStatuses(turnStarted, {
        activeTurnKey: 'u1',
        isWorking: true,
        workingStartedAt: 8_000,
        thinking: false
      }).active
    ).toEqual({ startedAt: 1_000, thinking: false, workedSeconds: null })
    // The exact request origin, once it arrives, may only move the anchor earlier.
    const exactOrigin = reduceNativeChatTurnTiming(turnStarted, {
      activeTurnKey: 'u1',
      validTurnKeys,
      isWorking: true,
      workingStartedAt: 900,
      now: 8_100
    })
    expect(exactOrigin.u1).toEqual({ startedAt: 900, workedSeconds: null })
  })
})
