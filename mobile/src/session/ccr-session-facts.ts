import type { CcrSessionRow } from './ccr-session-row'
import { ccrSessionStateOfRow, type ClaudeSessionState } from './claude-session-state'

/**
 * What the matched session's row says about the session itself, kept per tab for the header and
 * the workspace list: its `title` (the Claude app's header shows it), the app's list state
 * (claude-session-state.ts) and its `unread` mark. Written each time a tab's row is read (the
 * match and the minute's re-read, ccr-session-model-refresh.ts `noteModel`); nothing extra is
 * fetched for it.
 *
 * The header reads it only for the session the tab is matched to now (use-ccr-session-header.ts).
 * The list reads it only while fresh, newer than Orca's own row and about the session the tab is
 * matched to now (`ccrSessionFactsForAgent`); otherwise the list keeps Orca's own state. A tab
 * closed on the phone, or a match dropped, forgets its facts (`forgetCcrSessionFacts`).
 */

export type CcrSessionFacts = {
  sessionId: string
  epoch: number | null
  /** The row's title, trimmed; null when absent or blank. */
  title: string | null
  state: ClaudeSessionState
  /** Null when the row does not say. */
  unread: boolean | null
  fetchedAt: number
}

/** As long as the composer pill trusts a row (CCR_MODEL_FRESH_MS): a minute's re-read and slack. */
export const CCR_SESSION_FACTS_FRESH_MS = 90_000

const factsByTab = new Map<string, CcrSessionFacts>()
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

/** The fields a reader draws. A re-read that changes none of them still moves `fetchedAt` (the list
 *  times freshness from it) but tells no one: an open chat re-reads its row every minute, and a
 *  version bump re-rendered every subscriber each time for nothing. */
function sameDrawnFacts(a: CcrSessionFacts, b: CcrSessionFacts): boolean {
  return a.sessionId === b.sessionId && a.epoch === b.epoch && a.title === b.title && a.state === b.state && a.unread === b.unread
}

export function noteCcrSessionFacts(tabId: string, epoch: number | null, row: CcrSessionRow, now = Date.now()): void {
  const title = row.title?.trim() || null
  const next: CcrSessionFacts = { sessionId: row.id, epoch, title, state: ccrSessionStateOfRow(row, now), unread: row.unread ?? null, fetchedAt: now }
  const previous = factsByTab.get(tabId)
  factsByTab.set(tabId, next)
  if (!previous || !sameDrawnFacts(previous, next)) {
    changed()
  }
}

/** `cse_` and `session_` spellings of one id are the same session. */
export function sameCcrSessionId(a: string, b: string): boolean {
  const key = (id: string) => id.replace(/^session_/, 'cse_')
  return key(a) === key(b)
}

/** A rename that landed: every tab showing that session takes the new title at once. */
export function retitleCcrSessionFacts(sessionId: string, title: string): void {
  let touched = false
  for (const [tabId, facts] of factsByTab) {
    if (sameCcrSessionId(facts.sessionId, sessionId)) {
      factsByTab.set(tabId, { ...facts, title: title.trim() || null })
      touched = true
    }
  }
  if (touched) {
    changed()
  }
}

/** A mark_read that landed: the tab's Unread mark clears without waiting for the next re-read. */
export function markCcrSessionFactsRead(sessionId: string): void {
  let touched = false
  for (const [tabId, facts] of factsByTab) {
    if (facts.sessionId === sessionId && facts.unread) {
      factsByTab.set(tabId, { ...facts, unread: false })
      touched = true
    }
  }
  if (touched) {
    changed()
  }
}

export function forgetCcrSessionFacts(tabId: string): void {
  if (factsByTab.delete(tabId)) {
    changed()
  }
}

/** The tab's facts, only when they are about `sessionId` (the session the tab is matched to now). */
export function ccrSessionFactsForTab(tabId: string, sessionId: string | null): CcrSessionFacts | null {
  const facts = factsByTab.get(tabId)
  return facts && sessionId !== null && facts.sessionId === sessionId ? facts : null
}

/**
 * The facts of the tab an Orca agent row belongs to, only when they still describe what Orca
 * shows. Orca hears the agent live; the row is read at most once a minute, and only while the chat
 * is open. So the facts are dropped, and the caller keeps Orca's own state, when any of these holds:
 *
 *  - they are older than CCR_SESSION_FACTS_FRESH_MS;
 *  - Orca's row changed after they were read (`stateStartedAt` or `updatedAt` later than
 *    `fetchedAt`): a turn that ended at +20 s is done, whatever a row read at 0 s said, and a new
 *    session started in the tab is not the old one asking for input;
 *  - Orca's row carries no usable time at all: nothing then says which is newer, and a wrong
 *    state on the list is worse than Orca's (prefer refusing over guessing);
 *  - they are about another Anthropic session than the one the tab is matched to now
 *    (`currentSessionId`, ccr-session-cache.ts `ccrMappedSessionForTab`), or the tab has no match.
 *
 * Orca's `paneKey` is `<tabId>:<leafId>`, while the phone keys a terminal tab by its host address
 * `<tabId>::<leafId>`; a host that publishes no leaf address keys the tab by its bare id.
 */
export function ccrSessionFactsForAgent(
  agent: { paneKey: string; stateStartedAt?: number | null; updatedAt?: number | null },
  now: number,
  currentSessionId: (tabId: string) => string | null
): CcrSessionFacts | null {
  const separator = agent.paneKey.indexOf(':')
  const candidates =
    separator > 0
      ? [`${agent.paneKey.slice(0, separator)}::${agent.paneKey.slice(separator + 1)}`, agent.paneKey.slice(0, separator)]
      : [agent.paneKey]
  for (const tabId of candidates) {
    const facts = factsByTab.get(tabId)
    if (!facts) {
      continue
    }
    const age = now - facts.fetchedAt
    if (!(age >= 0 && age < CCR_SESSION_FACTS_FRESH_MS)) {
      return null
    }
    const orcaTimes = [agent.stateStartedAt, agent.updatedAt].filter((time): time is number => typeof time === 'number' && Number.isFinite(time) && time > 0)
    if (orcaTimes.length === 0 || Math.max(...orcaTimes) > facts.fetchedAt) {
      return null
    }
    const current = currentSessionId(tabId)
    return current !== null && sameCcrSessionId(current, facts.sessionId) ? facts : null
  }
  return null
}

export function subscribeCcrSessionFacts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function ccrSessionFactsVersion(): number {
  return version
}

export function resetCcrSessionFactsForTests(): void {
  factsByTab.clear()
  changed()
}

/** The header's title: the session's own title when known, else the worktree name, else Terminal. */
export function claudeSessionHeaderTitle(sessionTitle: string | null, worktreeName: string): string {
  return sessionTitle?.trim() || worktreeName || 'Terminal'
}
