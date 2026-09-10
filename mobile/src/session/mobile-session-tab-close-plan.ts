export type SessionTabClosePlan =
  | { via: 'terminal-handle'; handle: string; repeats: 2 }
  | { via: 'session-tab'; tabId: string; leafId?: string }

type ClosableSessionTab = {
  id: string
  type: string
  parentTabId?: string
  leafId?: string
  terminal?: string | null
}

type SessionTabContext = Pick<ClosableSessionTab, 'id' | 'parentTabId' | 'type'>

/**
 * A split leaf sharing its tab with another leaf. Closing one of those must not
 * close the parent tab, so it goes by PTY handle instead.
 *
 * The sibling is what makes it a split. The host addresses EVERY terminal tab
 * as `parentTabId::leafId` — `RuntimeMobileSessionTerminalTab` requires both
 * fields — so `parentTabId !== id` is true of a lone tab too, and reading it as
 * "split" sent every tab close down the handle path, which kills the PTY and
 * leaves the tab (0.3.4).
 */
export function sessionTabClosesByHandle(
  tab: SessionTabContext,
  siblings: readonly SessionTabContext[] = []
): boolean {
  if (tab.type !== 'terminal' || tab.parentTabId == null || tab.parentTabId === tab.id) {
    return false
  }
  return siblings.some(
    (candidate) =>
      candidate.type === 'terminal' &&
      candidate.id !== tab.id &&
      (candidate.parentTabId ?? candidate.id) === tab.parentTabId
  )
}

/**
 * Host `session.tabs.close` on a live split leaf only kills the PTY. The
 * renderer then skips pane close while siblings remain, so the empty shell
 * stays on desktop. A second `terminal.close`, with the PTY already dead,
 * is what sends `closeTerminal(tabId, paneRuntimeId)` and collapses it.
 */
/** `siblings` is the current tab strip. Without it no tab reads as split, so a
 *  close falls back to `session.tabs.close` — the safe answer, since that closes
 *  a whole tab rather than orphaning a pane. */
export function planSessionTabClose(
  tab: ClosableSessionTab,
  siblings: readonly SessionTabContext[] = []
): SessionTabClosePlan {
  if (
    tab.type === 'terminal' &&
    sessionTabClosesByHandle(tab, siblings) &&
    typeof tab.terminal === 'string'
  ) {
    return { via: 'terminal-handle', handle: tab.terminal, repeats: 2 }
  }
  // The tab's own id is already the host's address for it — a terminal tab is
  // published as `parentTabId::leafId`. Naming a leafId as well asks the host to
  // close one pane of a split, which this tab is not.
  return { via: 'session-tab', tabId: tab.id }
}
