import { describe, expect, it } from 'vitest'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  reduceStructuredAgentSession
} from '../../../src/shared/structured-agent-session-reducer'
import type { AgentSessionHistoryPage } from '../../../src/shared/agent-session-wire'

function item(sequence: number) {
  // itemId and revision are what mergeItems keys and compares on.
  return {
    itemId: `i${sequence}`,
    revision: 1,
    sequence,
    epoch: 'e1',
    item: { kind: 'text' as const, role: 'assistant' as const, text: `line ${sequence}` }
  } as never
}

function page(sequence: number[]): AgentSessionHistoryPage {
  const items = sequence.map(item)
  return {
    epoch: 'e1',
    items,
    hasOlder: true,
    submissions: [],
    removedItemIds: [],
    window: {
      oldest: { epoch: 'e1', sequence: sequence[0] ?? 0 },
      newest: { epoch: 'e1', sequence: sequence.at(-1) ?? 0 }
    }
  } as unknown as AgentSessionHistoryPage
}

/** Built directly: going through a tail page would also exercise the live-cursor
 *  and retention rules, which are not what these cases are about. */
function stateHolding(sequences: number[]) {
  return {
    ...EMPTY_STRUCTURED_AGENT_SESSION,
    epoch: 'e1',
    items: sequences.map(item),
    hasOlder: true
  }
}

describe('paging back through a structured transcript while it is still moving', () => {
  it('refuses a page that no longer touches what is on screen, instead of leaving a hole', () => {
    // Upstream #19845. The read is anchored on the oldest item held. If a live
    // batch trims the head past that anchor while the read is in flight, the
    // page that comes back starts further back than the retained window, and
    // merging it silently drops everything between. The caller re-anchors on
    // the new head and asks again.
    const state = stateHolding([50, 51, 52])

    const merged = reduceStructuredAgentSession(state, {
      type: 'older-page',
      requestedCursor: { epoch: 'e1', sequence: 10 },
      page: page([1, 2])
    })

    expect(merged).toBe(state)
  })

  it('takes a page that does still abut the window', () => {
    const state = stateHolding([50, 51, 52])

    const merged = reduceStructuredAgentSession(state, {
      type: 'older-page',
      requestedCursor: { epoch: 'e1', sequence: 50 },
      page: page([48, 49])
    })

    expect(merged.items.map((entry) => entry.sequence)).toEqual([48, 49, 50, 51, 52])
  })

  it('still refuses a page from a different epoch', () => {
    const state = stateHolding([50, 51])

    const merged = reduceStructuredAgentSession(state, {
      type: 'older-page',
      requestedCursor: { epoch: 'e0', sequence: 50 },
      page: page([48])
    })

    expect(merged).toBe(state)
  })
})
