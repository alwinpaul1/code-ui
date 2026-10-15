import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { CcrSessionRow } from './ccr-session-api'

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
 * When more than one session shares messages with the tab, the one holding
 * the tab's NEWEST shared message is the tab's: events are read newest first,
 * so a session that holds an older message of the tab and not the newer ones
 * it would have to hold above it stopped before them. That is a conversation's
 * earlier Remote Control session (a restarted `claude --resume` takes a new
 * `cse_…` id: the NexOS "Pull from main" transcript names three, 2026-10-07 to
 * 2026-10-14), or a fork's parent. Two sessions that both hold the tab's newest
 * shared message are refused, not guessed between (CLAUDE.md, "Prefer refusing
 * over guessing"), and the tab keeps its chips.
 */

export type CcrMatchCandidate = { sessionId: string; uuids: ReadonlySet<string> }

export type CcrMatch =
  | { kind: 'matched'; sessionId: string; overlap: number }
  | { kind: 'none'; candidates: number }
  | { kind: 'ambiguous'; sessionIds: string[] }

/** `tabMessageIds` in the tab's order, oldest first. */
export function matchCcrSession(tabMessageIds: readonly string[], candidates: readonly CcrMatchCandidate[]): CcrMatch {
  const position = new Map<string, number>()
  for (const [index, id] of tabMessageIds.entries()) {
    position.set(id, index)
  }
  const hits: { sessionId: string; overlap: number; newest: number }[] = []
  for (const candidate of candidates) {
    let overlap = 0
    let newest = -1
    for (const uuid of candidate.uuids) {
      const at = position.get(uuid)
      if (at !== undefined) {
        overlap += 1
        newest = Math.max(newest, at)
      }
    }
    if (overlap > 0) {
      hits.push({ sessionId: candidate.sessionId, overlap, newest })
    }
  }
  if (hits.length === 0) {
    return { kind: 'none', candidates: candidates.length }
  }
  const newest = Math.max(...hits.map((hit) => hit.newest))
  const holders = hits.filter((hit) => hit.newest === newest)
  if (holders.length === 1) {
    return { kind: 'matched', sessionId: holders[0]!.sessionId, overlap: holders[0]!.overlap }
  }
  return { kind: 'ambiguous', sessionIds: holders.map((hit) => hit.sessionId) }
}

/** How far the host's clock (a message's transcript time) and Anthropic's (a row's
 *  `last_event_at`) may disagree, plus the bridge's delay in posting a message. */
export const CCR_CLOCK_SKEW_MS = 10 * 60_000

/** The newest transcript time among the tab's messages, or null. A row from a hook or the screen
 *  is not the transcript's: its id is no uuid a session holds, and its time no message's. */
export function newestTranscriptMessageAt(messages: readonly Pick<NativeChatMessage, 'timestamp' | 'source'>[]): number | null {
  let newest: number | null = null
  for (const message of messages) {
    if (message.source === 'transcript' && typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) {
      newest = newest === null ? message.timestamp : Math.max(newest, message.timestamp)
    }
  }
  return newest
}

/**
 * The order the candidates' events are read in, most likely first. A hint for speed, never
 * proof: the match is still the shared messages.
 *
 * With the tab's newest message time known, the session whose last event is nearest to it, and
 * not before it, comes first: it is the one that wrote that message, idle or busy. Ranked
 * connected-first and newest-first instead, an idle tab's session sat behind every busier one
 * and was never read (0.9.150, 2026-10-15: "none of 16 Remote Control sessions shares a message
 * with this tab" on two work tabs, with 150 sessions listed). A session whose last event is
 * before the tab's newest message cannot hold it, and comes last, nearest first.
 *
 * Without a time, connected sessions first (a tab whose agent runs has its bridge connected),
 * then the newest.
 */
export function rankCcrCandidates<T extends { row: Pick<CcrSessionRow, 'connectionStatus' | 'activeAt'> }>(candidates: readonly T[], newestMessageAt: number | null): T[] {
  const connectedFirst = (a: T, b: T) => Number(b.row.connectionStatus === 'connected') - Number(a.row.connectionStatus === 'connected')
  const newestFirst = (a: T, b: T) => b.row.activeAt - a.row.activeAt
  if (newestMessageAt === null) {
    return [...candidates].sort((a, b) => connectedFirst(a, b) || newestFirst(a, b))
  }
  const floor = newestMessageAt - CCR_CLOCK_SKEW_MS
  const distance = (candidate: T) => Math.abs(candidate.row.activeAt - newestMessageAt)
  const since = candidates.filter((candidate) => candidate.row.activeAt >= floor).sort((a, b) => distance(a) - distance(b) || connectedFirst(a, b))
  const before = candidates.filter((candidate) => candidate.row.activeAt < floor).sort(newestFirst)
  return [...since, ...before]
}
