// The typed `turn` journal item from Orca #19695 (2626e2eca), pinned where the
// gate runs it: the shared reducer, projection and turn-record tests are
// vendored but never collected here — this fork's vitest root is `mobile/`.
// A host past #19695 writes the turn's lifecycle as its own item kind instead
// of a status row, and a phone that reads only the status row reports no live
// turn, paints the record as an empty bubble, and leaks the previous turn's
// activity copy into the live one.

import { describe, expect, it } from 'vitest'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../src/shared/agent-session-journal-types'
import { agentJournalTurnBody } from '../../../src/shared/agent-session-turn-record'
import type { AgentSessionHistoryPage } from '../../../src/shared/agent-session-wire'
import { isStructuredAgentSessionThinking } from '../../../src/shared/structured-agent-session-live-turn'
import {
  activeStructuredAgentSessionTurnId,
  projectStructuredItemToNativeChat
} from '../../../src/shared/structured-agent-session-projection'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  reduceStructuredAgentSession
} from '../../../src/shared/structured-agent-session-reducer'
import { selectStructuredAgentSettledTurns } from '../../../src/shared/structured-agent-session-turn-timing'
import { selectStructuredAgentTurnActivity } from './mobile-native-chat-turn-activity'

function item(
  itemId: string,
  sequence: number,
  body: AgentJournalRenderItem['body']
): AgentJournalRenderItem {
  return { itemId, revision: 1, sequence, observedAt: sequence, body }
}

function user(itemId: string, sequence: number): AgentJournalRenderItem {
  return item(itemId, sequence, {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: itemId }]
  })
}

function status(sequence: number, text: string): AgentJournalRenderItem {
  return item(`status-${sequence}`, sequence, { kind: 'status', text })
}

function turn(
  turnId: string,
  sequence: number,
  fields: Omit<Parameters<typeof agentJournalTurnBody>[0], 'turnId'>
): AgentJournalRenderItem {
  return item(`turn-${turnId}`, sequence, agentJournalTurnBody({ turnId, ...fields }))
}

function hydrationPage(items: AgentJournalRenderItem[], hostNow?: number): AgentSessionHistoryPage {
  const oldest = items[0]?.sequence ?? 0
  const newest = items.at(-1)?.sequence ?? 0
  return {
    sessionId: 'session-a',
    epoch: 'epoch-a',
    direction: 'tail',
    items,
    removedItemIds: [],
    submissions: [],
    window: {
      oldest: items[0] ? { epoch: 'epoch-a', sequence: oldest } : null,
      newest: items.at(-1) ? { epoch: 'epoch-a', sequence: newest } : null,
      nextCursor: { epoch: 'epoch-a', sequence: oldest }
    },
    liveCursor: { epoch: 'epoch-a', sequence: newest },
    hasOlder: false,
    hasNewer: false,
    ...(hostNow !== undefined ? { hostNow } : {})
  }
}

describe('the typed turn record a host past Orca #19695 writes', () => {
  it('is read as the live turn, exactly like the legacy status row', () => {
    const typed = [user('u1', 1), turn('t1', 2, { state: 'running', startedAt: 1_000 })]
    expect(activeStructuredAgentSessionTurnId(typed)).toBe('t1')
    const legacy = [
      user('u1', 1),
      item('lifecycle-t1', 2, {
        kind: 'status',
        text: 'Claude is working…',
        turnLifecycle: { turnId: 't1', state: 'running' }
      })
    ]
    expect(activeStructuredAgentSessionTurnId(legacy)).toBe('t1')
  })

  it('is settled by a revision in place, never a tombstone, and a settled one is no live turn', () => {
    const items = [
      user('u1', 1),
      turn('t1', 2, { state: 'completed', startedAt: 1_000, completedAt: 4_000 })
    ]
    expect(activeStructuredAgentSessionTurnId(items)).toBeNull()
    expect(activeStructuredAgentSessionTurnId([user('u1', 1), turn('t1', 2, { state: 'unverifiable', startedAt: 1_000 })])).toBeNull()
  })

  it('projects to no message, and neither does an item kind this build does not know', () => {
    // Timing is not content: the record must not paint as an empty bubble.
    expect(
      projectStructuredItemToNativeChat(
        turn('t1', 2, { state: 'completed', startedAt: 1_000, completedAt: 4_000 })
      )
    ).toBeNull()
    expect(
      projectStructuredItemToNativeChat(
        item('future', 3, { kind: 'future-kind', text: 'a newer host wrote this' } as never)
      )
    ).toBeNull()
  })

  it('bounds the live turn for the activity scan, so the previous turn cannot leak its copy', () => {
    // Turn 1 left "Reading files" behind; turn 2 is live and has said nothing.
    // A reader that misses the typed row scans back into turn 1 and shows that.
    const items = [
      user('u1', 1),
      turn('t1', 2, { state: 'completed', startedAt: 1_000, completedAt: 4_000 }),
      status(3, 'Reading files'),
      user('u2', 4),
      turn('t2', 5, { state: 'running', startedAt: 5_000 })
    ]
    expect(selectStructuredAgentTurnActivity(items, 't2', null)).toBeNull()
  })

  it('is the boundary the reasoning check stops at', () => {
    const items = [
      user('u1', 1),
      turn('t1', 2, { state: 'running', startedAt: 1_000 }),
      item('r1', 3, { kind: 'message', role: 'reasoning', blocks: [{ type: 'text', text: 'hm' }] })
    ]
    expect(isStructuredAgentSessionThinking(items)).toBe(true)
    expect(
      isStructuredAgentSessionThinking([
        ...items,
        turn('t1', 4, { state: 'completed', startedAt: 1_000, completedAt: 9_000 })
      ])
    ).toBe(false)
  })
})

describe('host-recorded turn durations', () => {
  it('come straight off the journal, keyed by the user message that opened the turn', () => {
    const items = [
      user('u1', 1),
      turn('t1', 2, { state: 'completed', startedAt: 1_000, completedAt: 62_500 }),
      user('u2', 3),
      // The provider measured this one itself; that number outranks the host interval.
      turn('t2', 4, {
        state: 'interrupted',
        startedAt: 70_000,
        completedAt: 99_000,
        durationMs: 12_345
      }),
      user('u3', 5),
      // The host lost this child without seeing it end: no duration, and the
      // null still outranks whatever the phone clocked locally.
      turn('t3', 6, { state: 'unverifiable', startedAt: 100_000 })
    ]
    expect([...selectStructuredAgentSettledTurns(items)]).toEqual([
      ['u1', { startedAt: 1_000, workedSeconds: 61 }],
      ['u2', { startedAt: 70_000, workedSeconds: 12 }],
      ['u3', null]
    ])
  })

  it('resolve a row that names its prompt by provider key through the submission alias', () => {
    const submissions: AgentJournalSubmission[] = [
      {
        clientMessageId: 'first',
        fence: 1,
        payloadFingerprint: 'fp',
        dispatchState: 'accepted',
        providerItemId: 'codex:thread:t1:0',
        reason: null,
        submittedAt: 1,
        resolvedAt: 2
      }
    ]
    const items = [
      user('orca:first', 1),
      turn('t1', 2, {
        state: 'completed',
        startedAt: 1_000,
        completedAt: 3_000,
        userItemId: 'codex:thread:t1:0'
      })
    ]
    expect([...selectStructuredAgentSettledTurns(items, submissions)]).toEqual([
      ['orca:first', { startedAt: 1_000, workedSeconds: 2 }]
    ])
  })

  it('are empty for an older host that records no start', () => {
    expect(
      selectStructuredAgentSettledTurns([user('u1', 1), turn('t1', 2, { state: 'completed' })]).size
    ).toBe(0)
  })
})

describe('the host clock on the structured session', () => {
  it('is recorded from frames that carry it and kept across frames that do not', () => {
    const snapshot = reduceStructuredAgentSession(
      EMPTY_STRUCTURED_AGENT_SESSION,
      {
        type: 'event',
        event: {
          type: 'snapshot',
          sessionId: 'session-a',
          fence: 1,
          page: hydrationPage([user('u1', 1)]),
          hostNow: 5_000
        }
      },
      9_000
    )
    expect(snapshot.hostClock).toEqual({ hostNow: 5_000, receivedAt: 9_000 })

    const batch = reduceStructuredAgentSession(
      snapshot,
      {
        type: 'event',
        event: {
          type: 'batch',
          sessionId: 'session-a',
          fence: 1,
          hostNow: 5_400,
          batch: {
            cursor: { epoch: 'epoch-a', sequence: 2 },
            items: [user('u2', 2)],
            removedItemIds: [],
            submissions: []
          }
        }
      },
      9_400
    )
    expect(batch.hostClock).toEqual({ hostNow: 5_400, receivedAt: 9_400 })

    // An older host stamps nothing; the last sample stays usable.
    const unstamped = reduceStructuredAgentSession(
      batch,
      {
        type: 'event',
        event: {
          type: 'batch',
          sessionId: 'session-a',
          fence: 1,
          batch: {
            cursor: { epoch: 'epoch-a', sequence: 3 },
            items: [user('u3', 3)],
            removedItemIds: [],
            submissions: []
          }
        }
      },
      9_800
    )
    expect(unstamped.hostClock).toEqual({ hostNow: 5_400, receivedAt: 9_400 })

    const paged = reduceStructuredAgentSession(
      unstamped,
      { type: 'history-page', page: hydrationPage([user('u4', 4)], 6_000) },
      10_000
    )
    expect(paged.hostClock).toEqual({ hostNow: 6_000, receivedAt: 10_000 })
    expect(
      reduceStructuredAgentSession(EMPTY_STRUCTURED_AGENT_SESSION, {
        type: 'history-page',
        page: hydrationPage([user('u1', 1)])
      }).hostClock
    ).toBeUndefined()
  })
})
