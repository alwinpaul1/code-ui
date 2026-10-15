import { describe, expect, it } from 'vitest'
import { CCR_HELD_UNDRAWN_EVENTS, CcrEventStore } from './ccr-link-store'
import { parseCcrEvent, type CcrEvent } from './ccr-session-api'
import { decodeCcrEvents } from './ccr-transcript-decode'
import { SESSION_A, event, systemEvent } from './fixtures/ccr-session-api-2026-10-14'

// Review 2026-10-15: a link held every event it was ever handed, and 84% of a session's events are
// `system` ones that draw nothing (observed live 2026-10-14), so a long-lived stream grew without
// bound. An undrawn event is needed only until it is counted (its sequence number).

const parsed = (raw: Record<string, unknown>): CcrEvent => parseCcrEvent(raw)!
const prompt = (uuid: string) => parsed(event({ type: 'user', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'user', content: uuid } }))
const keep = () => null

describe('the events a session link holds', () => {
  it('keeps only the newest undrawn events however many stream in, and every row', () => {
    const store = new CcrEventStore(keep)
    const first = prompt('u-first')
    store.add([first])
    const statuses = Array.from({ length: CCR_HELD_UNDRAWN_EVENTS * 3 }, (_row, index) => parsed(systemEvent(`s${index}`)))
    for (const status of statuses) {
      store.add([status])
    }
    const last = prompt('u-last')
    store.add([last])
    expect(store.ordered).toHaveLength(CCR_HELD_UNDRAWN_EVENTS + 2)
    expect(decodeCcrEvents(store.ordered).map((row) => row.id)).toEqual(['u-first', 'u-last'])
    expect(store.ordered.at(-2)).toBe(statuses.at(-1))
    expect(store.lastSequenceNum).toBe(last.sequenceNum)
  })

  it('a single undrawn event and an empty store are held as they are', () => {
    const store = new CcrEventStore(keep)
    expect(store.ordered).toEqual([])
    store.add([parsed(systemEvent('s-only'))])
    expect(store.ordered).toHaveLength(1)
  })
})
