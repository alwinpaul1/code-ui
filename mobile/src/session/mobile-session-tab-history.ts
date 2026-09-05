// Client-side "which tab did I look at before this one" memory for the phone.
//
// Why (#15219): phone tab switches activate with `navigation: 'caller'`, so the
// desktop never records them in its recentTabIds. When a tab is closed the
// client used to null its active tab and the next snapshot fell back to
// `tabs[0]`, jumping to the leftmost tab. This history lets close return to
// the previously viewed tab instead, and otherwise to the newest remaining one.

const MAX_TAB_HISTORY = 64

/** Move `tabId` to the most-recent end of `history` (mutates, capped). */
export function recordSessionTabVisit(history: string[], tabId: string | null | undefined): void {
  if (!tabId) {
    return
  }
  const existing = history.indexOf(tabId)
  if (existing !== -1) {
    history.splice(existing, 1)
  }
  history.push(tabId)
  if (history.length > MAX_TAB_HISTORY) {
    history.splice(0, history.length - MAX_TAB_HISTORY)
  }
}

export function forgetSessionTab(history: string[], tabId: string): void {
  const index = history.indexOf(tabId)
  if (index !== -1) {
    history.splice(index, 1)
  }
}

/**
 * The tab to activate after `closedTabId` closes: the most recently visited
 * tab that is still open, else the most recently added remaining tab (the
 * strip's last entry), else null when nothing remains.
 */
export function pickNextSessionTabAfterClose<T extends { id: string }>(
  remaining: readonly T[],
  history: readonly string[],
  closedTabId: string
): T | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const id = history[index]
    if (id === closedTabId) {
      continue
    }
    const tab = remaining.find((candidate) => candidate.id === id)
    if (tab) {
      return tab
    }
  }
  return remaining[remaining.length - 1] ?? null
}
