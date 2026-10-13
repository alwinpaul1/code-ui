import { useEffect, useRef } from 'react'
import type { MobileSessionTab } from './mobile-session-route-types'

/**
 * The tab a notification tap asked the session screen to select, from its route.
 *
 * A notification names a pane; the route used to carry only the workspace, so
 * a tap opened whatever tab the desktop or the phone had active — with two
 * agents in one workspace, the banner for one opened the other (2026-10-13).
 */
export type NotificationTabRequest = { paneKey: string } | { agentSessionId: string }

export type NotificationTabResolution =
  | { kind: 'open'; tab: MobileSessionTab }
  | { kind: 'gone' }
  | { kind: 'wait' }

/** The desktop's own address of a terminal leaf: `<tabId>:<leafId>`. The
 *  phone keys the same leaf `<tabId>::<leafId>`, so the two never compare
 *  equal as strings. */
function terminalPaneKey(tab: Extract<MobileSessionTab, { type: 'terminal' }>): string | null {
  return tab.leafId ? `${tab.parentTabId ?? tab.id}:${tab.leafId}` : null
}

function tabGroupId(tab: Extract<MobileSessionTab, { type: 'terminal' }>): string {
  return tab.parentTabId ?? tab.id
}

/**
 * Which of the workspace's tabs the request names. By stable identity only —
 * the pane key or the session id — never by position: a positional pick is
 * exactly the "landed on another tab" bug.
 *
 * Nothing until the live tabs are in. The strip can show the last visit's
 * cached tabs first: a tab missing from that cache may well be live, and one
 * present in it is selected with no client to tell the desktop, which leaves
 * the phone's pick pending against a desktop that never heard of it.
 */
export function resolveNotificationTab(
  tabs: readonly MobileSessionTab[],
  request: NotificationTabRequest,
  tabsLoaded: boolean
): NotificationTabResolution {
  if (!tabsLoaded) {
    return { kind: 'wait' }
  }
  let found: MobileSessionTab | undefined
  if ('paneKey' in request) {
    const terminals = tabs.filter(
      (tab): tab is Extract<MobileSessionTab, { type: 'terminal' }> => tab.type === 'terminal'
    )
    const separator = request.paneKey.indexOf(':')
    const requestedTabId = separator > 0 ? request.paneKey.slice(0, separator) : null
    found =
      terminals.find((tab) => terminalPaneKey(tab) === request.paneKey) ??
      terminals.find((tab) => tab.agentStatus?.paneKey === request.paneKey) ??
      // The tab is still there under another leaf id (a split re-laid out, or a
      // host that publishes the tab without its leaves): the tab beats no tab.
      (requestedTabId === null
        ? undefined
        : terminals.find((tab) => tabGroupId(tab) === requestedTabId))
  } else {
    found = tabs.find(
      (tab) => tab.type === 'agent-session' && tab.sessionId === request.agentSessionId
    )
  }
  return found ? { kind: 'open', tab: found } : { kind: 'gone' }
}

/**
 * Applies a notification's tab request once the workspace can answer it, then
 * spends it: selects the tab through the same path as a tap on its pill (which
 * the next snapshot honours over the desktop's active tab), or reports the tab
 * gone, and clears the route param either way so no later render or snapshot
 * replays it. A second tap on the same pane arrives after the clear, as a new
 * request.
 */
export function useNotificationTabRequest({
  worktreeId,
  request,
  sessionTabs,
  tabsLoaded,
  switchSessionTab,
  onTabGone,
  clearRequest
}: {
  worktreeId: string
  request: NotificationTabRequest | null
  sessionTabs: readonly MobileSessionTab[]
  tabsLoaded: boolean
  switchSessionTab: (tab: MobileSessionTab) => void
  onTabGone: () => void
  clearRequest: () => void
}): void {
  // The request already applied, until its param clears: the clear is a route
  // update and lands a render or more later, and every snapshot in between
  // would otherwise apply it again — pulling the user back after they moved on.
  const spentRef = useRef<string | null>(null)
  // Primitives, so a re-render with an equal request object is not a new request.
  const paneKey = request && 'paneKey' in request ? request.paneKey : null
  const agentSessionId = request && 'agentSessionId' in request ? request.agentSessionId : null
  useEffect(() => {
    const current: NotificationTabRequest | null =
      paneKey !== null ? { paneKey } : agentSessionId !== null ? { agentSessionId } : null
    if (current === null) {
      spentRef.current = null
      return
    }
    const key = JSON.stringify([worktreeId, paneKey, agentSessionId])
    if (spentRef.current === key) {
      return
    }
    const resolution = resolveNotificationTab(sessionTabs, current, tabsLoaded)
    switch (resolution.kind) {
      case 'wait':
        return
      case 'open':
        switchSessionTab(resolution.tab)
        break
      case 'gone':
        onTabGone()
        break
      default: {
        const unreachable: never = resolution
        return unreachable
      }
    }
    spentRef.current = key
    clearRequest()
  }, [
    worktreeId,
    paneKey,
    agentSessionId,
    sessionTabs,
    tabsLoaded,
    switchSessionTab,
    onTabGone,
    clearRequest
  ])
}
