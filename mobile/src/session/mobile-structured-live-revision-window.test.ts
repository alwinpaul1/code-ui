import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  oldestStructuredAgentSessionCursor,
  reduceStructuredAgentSession,
  type StructuredAgentSessionState
} from '../../../src/shared/structured-agent-session-reducer'

/**
 * A live revision of a row older than the loaded window (upstream #22377, vendored in the
 * v1.4.210..v1.4.211 shared halves). The revision keeps the row's original sequence, so merging
 * it would make it the window's oldest row, and that row is the anchor "load older" pages
 * `before`: every row between it and the real window head would never be fetched. The mobile gate
 * does not collect the vendored `src/shared` tests, so this is the phone's pin on the rule.
 */
function item(sequence: number, revision = 1): AgentJournalRenderItem {
  return {
    itemId: `item-${sequence}`,
    revision,
    sequence,
    observedAt: sequence,
    body: {
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: `t-${sequence} r${revision}` }]
    }
  }
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}

/** Built directly: a tail page would also run the live-cursor and retention rules. */
function windowHolding(sequences: number[], hasOlder: boolean): StructuredAgentSessionState {
  return {
    ...EMPTY_STRUCTURED_AGENT_SESSION,
    epoch: 'epoch-a',
    status: 'ready',
    cursor: { epoch: 'epoch-a', sequence: sequences.at(-1) ?? 0 },
    items: sequences.map((sequence) => item(sequence)),
    hasOlder
  }
}

function liveBatch(
  state: StructuredAgentSessionState,
  cursorSequence: number,
  items: AgentJournalRenderItem[]
): StructuredAgentSessionState {
  return reduceStructuredAgentSession(state, {
    type: 'event',
    event: {
      type: 'batch',
      sessionId: 'session-a',
      batch: {
        cursor: { epoch: 'epoch-a', sequence: cursorSequence },
        items,
        removedItemIds: [],
        submissions: []
      }
    }
  })
}

describe('a live revision of a row older than the loaded window', () => {
  it('keeps "load older" anchored on the window head, so no rows are skipped', () => {
    const state = windowHolding(range(150, 199), true)

    const next = liveBatch(state, 200, [item(50, 2), item(200)])

    expect(next.items[0]?.sequence).toBe(150)
    expect(next.items.some((entry) => entry.sequence === 50)).toBe(false)
    expect(oldestStructuredAgentSessionCursor(next)?.sequence).toBe(150)
    // The rest of the batch still lands: only the row below the window waits for a page.
    expect(next.items.at(-1)?.sequence).toBe(200)
  })

  it('still takes a revision of the window head itself', () => {
    const state = windowHolding(range(150, 199), true)

    const next = liveBatch(state, 200, [item(150, 2)])

    expect(next.items[0]).toMatchObject({ sequence: 150, revision: 2 })
  })

  it('takes it when nothing older is on the host, since the window is the whole journal', () => {
    const state = windowHolding(range(150, 199), false)

    const next = liveBatch(state, 200, [item(50, 2)])

    expect(next.items[0]).toMatchObject({ sequence: 50, revision: 2 })
  })

  it('takes it into an empty window, which has no head to hold', () => {
    const state = windowHolding([], true)

    const next = liveBatch(state, 200, [item(50, 2)])

    expect(next.items.map((entry) => entry.sequence)).toEqual([50])
  })

  it('holds the anchor on a one-row window too', () => {
    const state = windowHolding([150], true)

    const next = liveBatch(state, 200, [item(50, 2)])

    expect(next.items.map((entry) => entry.sequence)).toEqual([150])
  })
})
