/**
 * Which session a wave of reads may settle on (ccr-session-match-waves.ts).
 *
 * Reported in review of 33a6403c5 (2026-10-15): a wave's match returned at once, so a session
 * that held only an OLDER message of the tab (the conversation's Remote Control session from
 * before a `claude --resume` restart, or a fork's parent) won over the tab's own session whenever
 * the latter's newest message had not been read yet: on its second page, or in a later wave.
 * Event shapes are the recorded ones (fixtures/ccr-session-api-2026-10-14.ts).
 */
import { describe, expect, it } from 'vitest'
import type { CcrFetch, CcrFetchResponse } from './ccr-session-api'
import type { CcrAuth } from './ccr-session-accounts'
import { transcriptMessageIds } from './ccr-session-match'
import { matchCcrSessionInWaves, type CcrCandidate } from './ccr-session-match-waves'
import { CCR_MATCH_FIRST_PAGE_SIZE, CCR_MATCH_PAGES, CCR_MATCH_WAVES, CCR_MAX_CANDIDATES } from './ccr-session-shared'
import { assistantEvent, eventsReply, reply, systemEvent } from './fixtures/ccr-session-api-2026-10-14'

const AUTH: CcrAuth = { accountId: '77d1e0aa-0000-4000-8000-00000000a003', label: 'NexDash', token: 'not-a-real-credential', organizationUuid: '2b9c44d1-0000-4000-8000-00000000b004' }

const TRUE = 'cse_01TrueaaaaaaaaaaaaaaaJD8'
const OLD = 'cse_01OldaaaaaaaaaaaaaaaNWqu'
const busy = (n: number) => `cse_01Busy${String(n).padStart(2, '0')}aaaaaaaaaaaaaa`

/** The tab's transcript uuids, oldest first: m(1) … m(count). */
const m = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const tab = (count: number) => Array.from({ length: count }, (_, n) => m(n + 1))

const message = (n: number) => assistantEvent(m(n), `toolu_${n}`, `/tmp/${n}.png`)
const systemPage = (session: string, page: number, count = CCR_MATCH_FIRST_PAGE_SIZE) => Array.from({ length: count }, (_, n) => systemEvent(`${session}-p${page}-sys${n}`))

type Pages = (cursor: string | null) => CcrFetchResponse

function harness(sessions: Record<string, Pages>) {
  const sent: { session: string; cursor: string | null; limit: string | null }[] = []
  const fetch: CcrFetch = async (raw) => {
    const url = new URL(raw)
    const session = decodeURIComponent(url.pathname.split('/')[4]!)
    const cursor = url.searchParams.get('cursor')
    sent.push({ session, cursor, limit: url.searchParams.get('limit') })
    return sessions[session]?.(cursor) ?? reply(200, eventsReply(systemPage(session, 1)))
  }
  return { fetch, sent }
}

const candidate = (id: string): CcrCandidate => ({ row: { id, environmentKind: 'bridge', title: null, status: 'active', connectionStatus: 'connected', activeAt: 0, model: null, effortLevel: null }, auth: AUTH })
const matchedId = (outcome: Awaited<ReturnType<typeof matchCcrSessionInWaves>>) => (outcome.kind === 'matched' ? outcome.candidate.row.id : outcome.kind)

describe('an older session of the conversation does not win before the tab’s own is read through', () => {
  it('reads the tab’s session one page down when its first page holds only system events, and picks it over one holding an older message', async () => {
    const h = harness({
      // The tab's session: a first page of the turn's tail, its newest message on the second.
      [TRUE]: (cursor) => reply(200, cursor === null ? eventsReply(systemPage(TRUE, 1), 'p2') : eventsReply([message(7), message(6), message(5)])),
      // The session before the restart: it stopped at m2.
      [OLD]: () => reply(200, eventsReply([systemEvent('old-sys'), message(2)]))
    })
    const outcome = await matchCcrSessionInWaves(h.fetch, [candidate(TRUE), candidate(OLD)], tab(7))
    expect(matchedId(outcome)).toBe(TRUE)
  })

  it('reads on to the next wave for a tab’s session ranked fifth, past one holding an older message', async () => {
    const h = harness({
      [OLD]: () => reply(200, eventsReply([systemEvent('old-sys'), message(2)])),
      [TRUE]: () => reply(200, eventsReply([systemEvent('true-sys'), message(5), message(4)]))
    })
    const outcome = await matchCcrSessionInWaves(h.fetch, [candidate(busy(1)), candidate(busy(2)), candidate(busy(3)), candidate(OLD), candidate(TRUE)], tab(5))
    expect(matchedId(outcome)).toBe(TRUE)
  })

  it('when no session holds the tab’s newest message, reads everything and picks the newest shared one', async () => {
    const h = harness({
      [OLD]: () => reply(200, eventsReply([message(2)])),
      // m5 was never posted to any session; m4 is the newest any holds.
      [TRUE]: (cursor) => reply(200, cursor === null ? eventsReply(systemPage(TRUE, 1), 'p2') : eventsReply([message(4)]))
    })
    const outcome = await matchCcrSessionInWaves(h.fetch, [candidate(OLD), candidate(TRUE)], tab(5))
    expect(matchedId(outcome)).toBe(TRUE)
  })

  it('still refuses two sessions that hold the same newest shared message once everything is read', async () => {
    const h = harness({
      [OLD]: () => reply(200, eventsReply([message(3)])),
      [TRUE]: (cursor) => reply(200, cursor === null ? eventsReply(systemPage(TRUE, 1), 'p2') : eventsReply([message(3)]))
    })
    const outcome = await matchCcrSessionInWaves(h.fetch, [candidate(OLD), candidate(TRUE)], tab(5))
    expect(outcome).toEqual({ kind: 'ambiguous', sessionIds: [OLD, TRUE] })
  })
})

describe('what it costs', () => {
  it('finishes in one wave of four first pages when the tab’s session holds its newest message on page one', async () => {
    const h = harness({
      [TRUE]: () => reply(200, eventsReply([systemEvent('true-sys'), message(5), message(4)], 'p2')),
      [OLD]: () => reply(200, eventsReply([message(2)], 'p2'))
    })
    const ranked = [candidate(TRUE), candidate(OLD), ...Array.from({ length: 20 }, (_, n) => candidate(busy(n)))]
    const outcome = await matchCcrSessionInWaves(h.fetch, ranked, tab(5))
    expect(matchedId(outcome)).toBe(TRUE)
    expect(h.sent).toHaveLength(CCR_MATCH_WAVES[0])
    expect(h.sent.every((entry) => entry.cursor === null && entry.limit === String(CCR_MATCH_FIRST_PAGE_SIZE))).toBe(true)
  })

  it('refuses at once when two sessions of the first wave both hold the tab’s newest message', async () => {
    const h = harness({
      [TRUE]: () => reply(200, eventsReply([message(5)], 'p2')),
      [OLD]: () => reply(200, eventsReply([message(5)], 'p2'))
    })
    const outcome = await matchCcrSessionInWaves(h.fetch, [candidate(TRUE), candidate(OLD), ...Array.from({ length: 20 }, (_, n) => candidate(busy(n)))], tab(5))
    expect(outcome.kind).toBe('ambiguous')
    expect(h.sent).toHaveLength(CCR_MATCH_WAVES[0])
  })

  it('reads at most every candidate’s pages, once each, when nothing holds the tab’s newest message', async () => {
    const sessions: Record<string, Pages> = {}
    const ranked = Array.from({ length: CCR_MAX_CANDIDATES }, (_, n) => candidate(busy(n)))
    for (const one of ranked) {
      // Never-ending sessions: every page has one behind it.
      sessions[one.row.id] = (cursor) => reply(200, eventsReply(systemPage(one.row.id, Number(cursor ?? '1')), String(Number(cursor ?? '1') + 1)))
    }
    const h = harness(sessions)
    const outcome = await matchCcrSessionInWaves(h.fetch, ranked, tab(5))
    expect(outcome.kind).toBe('none')
    expect(h.sent).toHaveLength(CCR_MAX_CANDIDATES * CCR_MATCH_PAGES)
    expect(new Set(h.sent.map((entry) => `${entry.session} ${entry.cursor}`)).size).toBe(h.sent.length)
  })

  it('handles one candidate and none', async () => {
    const one = harness({ [TRUE]: () => reply(200, eventsReply([message(1)])) })
    expect(matchedId(await matchCcrSessionInWaves(one.fetch, [candidate(TRUE)], tab(1)))).toBe(TRUE)
    expect(one.sent).toHaveLength(1)
    const none = harness({})
    expect(await matchCcrSessionInWaves(none.fetch, [], tab(1))).toEqual({ kind: 'none', exhaustive: true })
    expect(none.sent).toHaveLength(0)
  })
})

describe('the tab’s newest message', () => {
  it('is its newest transcript row, so a prompt not written to the transcript yet still lets the first wave finish', async () => {
    // The phone's optimistic prompt and a scraped line sit below the transcript's m5: no session holds their ids.
    const messages = [
      ...tab(5).map((id) => ({ id, source: 'transcript' as const })),
      { id: 'local-prompt-1760516400000', source: 'hook' as const },
      { id: 'scrape-0', source: 'scrape' as const }
    ]
    const h = harness({ [TRUE]: () => reply(200, eventsReply([message(5), message(4)], 'p2')) })
    const ranked = [candidate(TRUE), ...Array.from({ length: 20 }, (_, n) => candidate(busy(n)))]
    const outcome = await matchCcrSessionInWaves(h.fetch, ranked, transcriptMessageIds(messages))
    expect(matchedId(outcome)).toBe(TRUE)
    expect(h.sent).toHaveLength(CCR_MATCH_WAVES[0])
  })

  it('is absent for a tab with no transcript rows', () => {
    expect(transcriptMessageIds([{ id: 'scrape-0', source: 'scrape' }])).toEqual([])
    expect(transcriptMessageIds([])).toEqual([])
  })
})
