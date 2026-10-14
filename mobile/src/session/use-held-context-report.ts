import type { ClaudeContextReport, ContextBreakdown, ContextReportRead } from './claude-context-report'
import { stickyScopeKey } from './use-sticky-live-hud'

/** What each tab, terminal and session last had on its screen as a `/context` table, at MODULE scope
 *  for the reason `use-sticky-live-hud.ts` gives: the chat view is torn down and rebuilt on every
 *  flip and route change, and a hold that lived in it would be gone with it. */
const heldByScope = new Map<string, ContextBreakdown>()

/** One per open tab is plenty; oldest untouched shed first (the sticky hold's rule). */
const HELD_CONTEXT_REPORT_CAP = 32

export function clearHeldContextReportsForTests(): void {
  heldByScope.clear()
}

function sameReport(a: ClaudeContextReport, b: ClaudeContextReport): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The last `/context` table the screen showed for this session, kept after it has scrolled away.
 *
 * `/context` paints once. The user (or the phone's own composer) runs it, Claude Code prints it, and
 * the next thing the agent says pushes it up and off. The context sheet is opened minutes later, so
 * it reads the table from here rather than from the screen it was on.
 *
 * Held under the sticky HUD's own key (tab, terminal and session; `stickyScopeKey`), so a `/clear`, a
 * new agent in the same terminal or another tab starts with none. A table is another table when its
 * figures differ, and is then stamped again; the same table on the next poll keeps its first stamp,
 * because the sheet says how old it is ("Updated 3 min ago") and a poll is not an update. A table that
 * was already on the screen as the phone began to watch has no stamp: it was painted at some time
 * before, and an age claimed for it would be a guess.
 */
export function useHeldContextReport(
  read: ContextReportRead | null,
  tabId: string | null,
  handle: string | null,
  sessionId: string | null
): ContextBreakdown | null {
  const key = stickyScopeKey(tabId, handle, sessionId)
  const current = heldByScope.get(key) ?? null
  const held =
    read !== null && (current === null || !sameReport(current.report, read.report))
      ? { report: read.report, readAt: read.firstRead ? null : Date.now() }
      : current
  if (held === null) {
    return null
  }
  // Delete-then-set on every read: the scope being looked at is the most recent, so eviction only
  // sheds one nobody has looked at.
  heldByScope.delete(key)
  heldByScope.set(key, held)
  while (heldByScope.size > HELD_CONTEXT_REPORT_CAP) {
    const oldest = heldByScope.keys().next().value
    if (oldest === undefined) {
      break
    }
    heldByScope.delete(oldest)
  }
  return held
}
