// The shared reducer's own test file (src/shared/structured-agent-session-reducer.test.ts)
// is vendored but never collected here — this fork's vitest root is `mobile/`.
// So the catalog behaviour is pinned where the gate actually runs it. A batch
// that reports a catalog is never dropped by the journal-unchanged
// short-circuit (Orca #18757): the check compares `commands` by reference, and
// a reported catalog is a fresh array.

import { describe, expect, it } from 'vitest'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionHistoryPage } from '../../../src/shared/agent-session-wire'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  reduceStructuredAgentSession
} from '../../../src/shared/structured-agent-session-reducer'

function item(id: string, sequence: number): AgentJournalRenderItem {
  return {
    itemId: id,
    revision: 1,
    sequence,
    observedAt: sequence,
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: id }] }
  }
}

function hydrationPage(
  items: AgentJournalRenderItem[],
  submissions: AgentJournalSubmission[] = []
): AgentSessionHistoryPage {
  const oldest = items[0]?.sequence ?? 0
  const newest = items.at(-1)?.sequence ?? 0
  return {
    sessionId: 'session-a',
    epoch: 'epoch-a',
    direction: 'tail',
    items,
    removedItemIds: [],
    submissions,
    window: {
      oldest: items[0] ? { epoch: 'epoch-a', sequence: oldest } : null,
      newest: items.at(-1) ? { epoch: 'epoch-a', sequence: newest } : null,
      nextCursor: { epoch: 'epoch-a', sequence: oldest }
    },
    liveCursor: { epoch: 'epoch-a', sequence: newest },
    hasOlder: false,
    hasNewer: false
  }
}

function seeded() {
  return reduceStructuredAgentSession(EMPTY_STRUCTURED_AGENT_SESSION, {
    type: 'event',
    event: {
      type: 'snapshot',
      sessionId: 'session-a',
      fence: 1,
      page: hydrationPage([item('one', 1)]),
      commands: []
    }
  })
}

describe('the `/` catalog a structured session reports', () => {
  it('arrives with the frame that proves the session', () => {
    expect(seeded().commands).toEqual([])
  })

  it('lands from a later report without disturbing the transcript', () => {
    const state = seeded()
    const commands = [{ name: 'loaded', kind: 'skill' as const }]
    const updated = reduceStructuredAgentSession(state, {
      type: 'event',
      event: {
        type: 'batch',
        sessionId: 'session-a',
        fence: 1,
        commands,
        batch: { cursor: state.cursor!, items: [], removedItemIds: [], submissions: [] }
      }
    })
    expect(updated.commands).toEqual(commands)
    expect(updated.items).toEqual(state.items)
    expect(updated.submissions).toEqual(state.submissions)
    expect(updated.cursor).toBe(state.cursor)
  })

  it('survives a batch that reports no catalog at all', () => {
    const state = seeded()
    const commands = [{ name: 'loaded', kind: 'skill' as const }]
    const withCatalog = reduceStructuredAgentSession(state, {
      type: 'event',
      event: {
        type: 'batch',
        sessionId: 'session-a',
        fence: 1,
        commands,
        batch: { cursor: state.cursor!, items: [], removedItemIds: [], submissions: [] }
      }
    })
    const later = reduceStructuredAgentSession(withCatalog, {
      type: 'event',
      event: {
        type: 'batch',
        sessionId: 'session-a',
        fence: 1,
        batch: {
          cursor: withCatalog.cursor!,
          items: [item('two', 2)],
          removedItemIds: [],
          submissions: []
        }
      }
    })
    expect(later.commands).toEqual(commands)
  })

  it('is cleared by a provider that reports null', () => {
    const state = seeded()
    const cleared = reduceStructuredAgentSession(state, {
      type: 'event',
      event: {
        type: 'batch',
        sessionId: 'session-a',
        fence: 1,
        commands: null,
        batch: { cursor: state.cursor!, items: [], removedItemIds: [], submissions: [] }
      }
    })
    expect(cleared.commands).toBeNull()
  })

  it('survives a tail refresh of the same epoch', () => {
    const state = seeded()
    const commands = [{ name: 'loaded', kind: 'skill' as const }]
    const withCatalog = reduceStructuredAgentSession(state, {
      type: 'event',
      event: {
        type: 'batch',
        sessionId: 'session-a',
        fence: 2,
        commands,
        batch: {
          cursor: state.cursor!,
          items: [item('two', 2)],
          removedItemIds: [],
          submissions: []
        }
      }
    })
    const refreshed = reduceStructuredAgentSession(withCatalog, {
      type: 'tail-page',
      page: hydrationPage([item('one', 1), item('two', 2), item('three', 3)])
    })
    expect(refreshed.commands).toEqual(commands)
  })
})
