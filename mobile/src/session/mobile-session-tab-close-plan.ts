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

/** A split leaf `session.tabs` omitted. Closing it must not close the parent tab. */
export function sessionTabClosesByHandle(
  tab: Pick<ClosableSessionTab, 'id' | 'parentTabId' | 'type'>
): boolean {
  return tab.type === 'terminal' && tab.parentTabId != null && tab.parentTabId !== tab.id
}

/** Host close addresses a split leaf as `parentTabId::leafId`. A single colon
 *  is not that address, and `session.tabs.close` on the parent id closes the
 *  whole tab. */
export function sessionTabCloseAddress(
  tab: Pick<ClosableSessionTab, 'id' | 'parentTabId' | 'leafId' | 'type'>
): { tabId: string; leafId?: string } {
  if (tab.type === 'terminal' && tab.parentTabId && tab.leafId) {
    return { tabId: `${tab.parentTabId}::${tab.leafId}`, leafId: tab.leafId }
  }
  return { tabId: tab.id, leafId: tab.leafId }
}

/**
 * Host `session.tabs.close` on a live split leaf only kills the PTY. The
 * renderer then skips pane close while siblings remain, so the empty shell
 * stays on desktop. A second `terminal.close`, with the PTY already dead,
 * is what sends `closeTerminal(tabId, paneRuntimeId)` and collapses it.
 */
export function planSessionTabClose(tab: ClosableSessionTab): SessionTabClosePlan {
  if (
    tab.type === 'terminal' &&
    sessionTabClosesByHandle(tab) &&
    typeof tab.terminal === 'string'
  ) {
    return { via: 'terminal-handle', handle: tab.terminal, repeats: 2 }
  }
  const address = sessionTabCloseAddress(
    tab.type === 'terminal' ? tab : { id: tab.id, type: 'terminal' }
  )
  return { via: 'session-tab', tabId: address.tabId, leafId: address.leafId }
}
