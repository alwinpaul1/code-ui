export type SessionTabClosePlan =
  | { via: 'terminal-handle'; handle: string }
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
 * A split leaf closes through `terminal.close` on its own handle — the host's
 * own CLI calls that "closes one terminal pane/session", and closing the whole
 * tab is a separate `--tab` mode it reports back as `closeMode: 'tab'`.
 *
 * Exactly ONE call. Checked against a live host on a real two-leaf tab: the
 * first close answers `ptyKilled: true` and leaves the sibling connected; a
 * second close on that same, now-dead handle answers `ptyKilled: false` and
 * takes the WHOLE TAB, sibling included. 0.3.4 sent two on the theory that the
 * desktop pane needed a second nudge to collapse — it does not, and the repeat
 * is why closing the lower pane from the phone closed the window.
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
    return { via: 'terminal-handle', handle: tab.terminal }
  }
  // The tab's own id is already the host's address for it — a terminal tab is
  // published as `parentTabId::leafId`. Naming a leafId as well asks the host to
  // close one pane of a split, which this tab is not.
  return { via: 'session-tab', tabId: tab.id }
}
