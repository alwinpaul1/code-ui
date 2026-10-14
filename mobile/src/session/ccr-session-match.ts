/**
 * Which of the account's Remote Control sessions an Orca tab is.
 *
 * The tab knows its messages by their transcript uuids (Orca's reader keys a
 * row by `record.uuid`, orca transcript-line-decoders-claude.ts:30,58), and a
 * bridge session's events carry the same messages with their uuids kept
 * (Claude Code 2.1.296's remote bridge maps each live message as
 * `{...r, session_id: C}`, leaving `uuid` as it was, @211524314). So the
 * session whose recent events share uuids with the tab is the tab's.
 *
 * Refuses rather than guesses (CLAUDE.md, "Prefer refusing over guessing"):
 * when two sessions both share uuids with the tab — a resumed or forked
 * conversation can carry the same history — no session is picked, and the
 * tab keeps its chips.
 */

export type CcrMatchCandidate = { sessionId: string; uuids: ReadonlySet<string> }

export type CcrMatch =
  | { kind: 'matched'; sessionId: string; overlap: number }
  | { kind: 'none'; candidates: number }
  | { kind: 'ambiguous'; sessionIds: string[] }

export function matchCcrSession(tabMessageIds: ReadonlySet<string>, candidates: readonly CcrMatchCandidate[]): CcrMatch {
  const hits: { sessionId: string; overlap: number }[] = []
  for (const candidate of candidates) {
    let overlap = 0
    for (const uuid of candidate.uuids) {
      if (tabMessageIds.has(uuid)) {
        overlap += 1
      }
    }
    if (overlap > 0) {
      hits.push({ sessionId: candidate.sessionId, overlap })
    }
  }
  if (hits.length === 1) {
    return { kind: 'matched', sessionId: hits[0]!.sessionId, overlap: hits[0]!.overlap }
  }
  if (hits.length > 1) {
    return { kind: 'ambiguous', sessionIds: hits.map((hit) => hit.sessionId) }
  }
  return { kind: 'none', candidates: candidates.length }
}
