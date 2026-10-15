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
 * The list reads it only while fresh (CCR_SESSION_FACTS_FRESH_MS): the row is re-read only while
 * the chat is open, so an older reading would draw a state the session has moved on from, and the
 * list then keeps Orca's own state.
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

export function noteCcrSessionFacts(tabId: string, epoch: number | null, row: CcrSessionRow, now = Date.now()): void {
  const title = row.title?.trim() || null
  factsByTab.set(tabId, { sessionId: row.id, epoch, title, state: ccrSessionStateOfRow(row, now), unread: row.unread ?? null, fetchedAt: now })
  changed()
}

/** A rename that landed: every tab showing that session takes the new title at once. `cse_` and
 *  `session_` spellings of one id are the same session. */
export function retitleCcrSessionFacts(sessionId: string, title: string): void {
  const key = (id: string) => id.replace(/^session_/, 'cse_')
  let touched = false
  for (const [tabId, facts] of factsByTab) {
    if (key(facts.sessionId) === key(sessionId)) {
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

/** The facts of the tab an Orca pane belongs to (`<tabId>:<leafId>`), only while fresh. */
export function freshCcrSessionFactsForPane(paneKey: string, now: number): CcrSessionFacts | null {
  const separator = paneKey.indexOf(':')
  const tabId = separator > 0 ? paneKey.slice(0, separator) : paneKey
  const facts = factsByTab.get(tabId)
  return facts && now - facts.fetchedAt >= 0 && now - facts.fetchedAt < CCR_SESSION_FACTS_FRESH_MS ? facts : null
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
