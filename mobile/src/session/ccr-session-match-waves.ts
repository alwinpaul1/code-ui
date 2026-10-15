import { listCcrSessionEvents, type CcrEvent, type CcrFetch, type CcrSessionRow } from './ccr-session-api'
import type { CcrAuth } from './ccr-session-accounts'
import { matchCcrSession } from './ccr-session-match'
import { CCR_EVENT_PAGE_SIZE, CCR_MATCH_FIRST_PAGE_SIZE, CCR_MATCH_PAGES, CCR_MATCH_WAVES } from './ccr-session-shared'

export type CcrCandidate = { row: CcrSessionRow; auth: CcrAuth }
/** One candidate's events read so far, newest first, and where its next page starts. */
export type CcrCandidatePages = { events: CcrEvent[]; uuids: Set<string>; cursor: string | null; read: number }

export type CcrWavesOutcome =
  | { kind: 'matched'; candidate: CcrCandidate; pages: CcrCandidatePages; overlap: number }
  | { kind: 'none' }
  | { kind: 'ambiguous'; sessionIds: string[] }
  /** Some candidates' events could not be read: `reasons` are each one's error, of `compared`. */
  | { kind: 'unreadable'; reasons: unknown[]; candidates: CcrCandidate[]; compared: number }

/**
 * Reads the ranked candidates' events in waves until one of them holds the tab's NEWEST message,
 * or the candidates and their pages run out (ccr-session-match.ts).
 *
 * Each wave is one round trip: the next CCR_MATCH_WAVES candidates' newest
 * CCR_MATCH_FIRST_PAGE_SIZE events, and one page deeper (CCR_EVENT_PAGE_SIZE) of every candidate
 * read before that has more, up to CCR_MATCH_PAGES pages each. Once the fresh candidates run out,
 * waves of deeper pages alone continue until those run out too.
 *
 * Only a candidate holding the tab's newest message ends the reading early: nothing can beat it
 * (two holding it are refused at once). A match on an OLDER message is not final, because the
 * tab's own session may hold the newer one on a page or in a wave not read yet, while an earlier
 * session of the same conversation (before a `claude --resume` restart, or a fork's parent)
 * stopped at the older one. Reviewed 2026-10-15 on 33a6403c5, which returned a wave's match at
 * once and so picked such an earlier session. When everything is read and nothing holds the newest
 * message, the newest shared message decides, ties refused.
 *
 * Cost: the common case (the tab's session ranked in the first wave, its newest message on page
 * one) is one wave of CCR_MATCH_WAVES[0] requests. The worst case reads every candidate's
 * CCR_MATCH_PAGES pages once: CCR_MAX_CANDIDATES x CCR_MATCH_PAGES = 96 requests over five waves.
 * A wave with an unreadable candidate ends the reading: any of them may be the tab's.
 */
export async function matchCcrSessionInWaves(fetchImpl: CcrFetch, candidates: readonly CcrCandidate[], tabMessageIds: readonly string[]): Promise<CcrWavesOutcome> {
  /** Paging per account and session: each account reads with its own cursor. */
  const pageKey = (candidate: CcrCandidate) => `${candidate.auth.accountId}\0${candidate.row.id}`
  const pages = new Map<string, CcrCandidatePages>()
  const newestId = tabMessageIds.at(-1)
  const holdsNewest = (sessionId: string) => newestId !== undefined && candidates.some((one) => one.row.id === sessionId && pages.get(pageKey(one))?.uuids.has(newestId) === true)
  let introduced = 0
  for (let wave = 0; ; wave += 1) {
    const size = CCR_MATCH_WAVES[wave] ?? 0
    const deeper = candidates.slice(0, introduced).filter((candidate) => {
      const held = pages.get(pageKey(candidate))
      return held !== undefined && held.cursor !== null && held.read < CCR_MATCH_PAGES
    })
    const fresh = candidates.slice(introduced, introduced + size)
    introduced += fresh.length
    const reading = [...fresh, ...deeper]
    if (reading.length === 0) {
      break
    }
    const read = await Promise.allSettled(
      reading.map((candidate) => {
        const held = pages.get(pageKey(candidate))
        return listCcrSessionEvents(fetchImpl, candidate.auth, candidate.row.id, {
          cursor: held?.cursor ?? null,
          limit: held ? CCR_EVENT_PAGE_SIZE : CCR_MATCH_FIRST_PAGE_SIZE
        })
      })
    )
    const reasons: unknown[] = []
    const unreadable: CcrCandidate[] = []
    for (const [index, answer] of read.entries()) {
      const candidate = reading[index]!
      if (answer.status === 'rejected') {
        reasons.push(answer.reason)
        unreadable.push(candidate)
        continue
      }
      const held = pages.get(pageKey(candidate))
      const uuids = held?.uuids ?? new Set<string>()
      for (const event of answer.value.events) {
        const uuid = event.payload.uuid
        if (typeof uuid === 'string') {
          uuids.add(uuid)
        }
      }
      // A cursor handed back unchanged has nothing more behind it.
      const next = answer.value.nextCursor === (held?.cursor ?? null) ? null : answer.value.nextCursor
      pages.set(pageKey(candidate), { events: [...(held?.events ?? []), ...answer.value.events], uuids, cursor: next, read: (held?.read ?? 0) + 1 })
    }
    if (unreadable.length > 0) {
      return { kind: 'unreadable', reasons, candidates: unreadable, compared: introduced }
    }
    const settled = judge(candidates.slice(0, introduced))
    if (settled.kind === 'matched' && holdsNewest(settled.candidate.row.id)) {
      return settled
    }
    if (settled.kind === 'ambiguous' && holdsNewest(settled.sessionIds[0]!)) {
      return settled
    }
  }
  return judge(candidates.slice(0, introduced))

  function judge(compared: readonly CcrCandidate[]): Exclude<CcrWavesOutcome, { kind: 'unreadable' }> {
    const match = matchCcrSession(tabMessageIds, compared.map((candidate) => ({ sessionId: candidate.row.id, uuids: pages.get(pageKey(candidate))?.uuids ?? new Set() })))
    switch (match.kind) {
      case 'ambiguous':
        return { kind: 'ambiguous', sessionIds: match.sessionIds }
      case 'none':
        return { kind: 'none' }
      case 'matched': {
        const candidate = compared.find((one) => one.row.id === match.sessionId)!
        return { kind: 'matched', candidate, pages: pages.get(pageKey(candidate))!, overlap: match.overlap }
      }
      default: {
        const unhandled: never = match
        return unhandled
      }
    }
  }
}
