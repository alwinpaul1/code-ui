import { useEffect, useRef, useState } from 'react'
import type { MobileSessionTab } from './mobile-session-route-types'

/**
 * The tab a notification tap asked the session screen to select, from its route.
 *
 * A notification names a pane; the route used to carry only the workspace, so
 * a tap opened whatever tab the desktop or the phone had active — with two
 * agents in one workspace, the banner for one opened the other (2026-10-13).
 */
export type NotificationTabRequest = { paneKey: string } | { agentSessionId: string }

/** How long the host has to be connected, with the live tabs in and none of
 *  them the notified one, before the tab is called closed when no newer
 *  snapshot comes to say so. A republication with nothing changed keeps the
 *  same list, so "a snapshot newer than the tap" can never arrive for a tab
 *  that closed before it. Longer than the 5–6 s a relay takes to recover. */
export const NOTIFICATION_TAB_GONE_AFTER_MS = 10_000

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
      // A host that publishes a tab without its leaf address: the tab id is
      // all there is to match. Never the other leaves of a split — the phone
      // draws a pill per leaf, so a closed leaf is a closed tab, and opening
      // its sibling would be the positional pick this exists to avoid.
      (requestedTabId === null
        ? undefined
        : terminals.find((tab) => !tab.leafId && tab.id === requestedTabId))
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
 *
 * A tab is opened only while connected, and called gone only on evidence
 * newer than the tap: a non-empty tab list that changed since the tap
 * arrived, or NOTIFICATION_TAB_GONE_AFTER_MS connected with it still missing.
 * Back from the background the screen still holds the tabs from before it,
 * marked loaded while the relay redials, and an empty snapshot is transient on
 * this host (review findings, 2026-10-13); neither proves a close.
 */
export function useNotificationTabRequest({
  worktreeId,
  request,
  sessionTabs,
  tabsLoaded,
  connected,
  switchSessionTab,
  onTabGone,
  clearRequest
}: {
  worktreeId: string
  request: NotificationTabRequest | null
  sessionTabs: readonly MobileSessionTab[]
  tabsLoaded: boolean
  connected: boolean
  switchSessionTab: (tab: MobileSessionTab) => void
  onTabGone: () => void
  clearRequest: () => void
}): void {
  // The request already applied, until its param clears: the clear is a route
  // update and lands a render or more later, and every snapshot in between
  // would otherwise apply it again — pulling the user back after they moved on.
  const spentRef = useRef<string | null>(null)
  // The tab list on screen when the request arrived, to tell a newer one from it.
  const arrivalRef = useRef<{ key: string; tabs: readonly MobileSessionTab[] } | null>(null)
  const [timedOutKey, setTimedOutKey] = useState<string | null>(null)
  // Primitives, so a re-render with an equal request object is not a new request.
  const paneKey = request && 'paneKey' in request ? request.paneKey : null
  const agentSessionId = request && 'agentSessionId' in request ? request.agentSessionId : null
  const key = request === null ? null : JSON.stringify([worktreeId, paneKey, agentSessionId])
  useEffect(() => {
    const current: NotificationTabRequest | null =
      paneKey !== null ? { paneKey } : agentSessionId !== null ? { agentSessionId } : null
    if (current === null || key === null) {
      spentRef.current = null
      arrivalRef.current = null
      return
    }
    if (spentRef.current === key) {
      return
    }
    if (arrivalRef.current?.key !== key) {
      arrivalRef.current = { key, tabs: sessionTabs }
    }
    const resolution = resolveNotificationTab(sessionTabs, current, tabsLoaded)
    switch (resolution.kind) {
      case 'wait':
        return
      case 'open':
        if (!connected) {
          return
        }
        switchSessionTab(resolution.tab)
        break
      case 'gone': {
        const newerTabs = sessionTabs !== arrivalRef.current.tabs && sessionTabs.length > 0
        if (!newerTabs && timedOutKey !== key) {
          return
        }
        onTabGone()
        break
      }
      default: {
        const unreachable: never = resolution
        return unreachable
      }
    }
    spentRef.current = key
    clearRequest()
  }, [
    key,
    paneKey,
    agentSessionId,
    sessionTabs,
    tabsLoaded,
    connected,
    timedOutKey,
    switchSessionTab,
    onTabGone,
    clearRequest
  ])
  // The clock for a tab no snapshot will ever name. Restarts on every change of
  // request or connection, so it only ever measures time spent connected.
  useEffect(() => {
    if (key === null || !tabsLoaded || !connected || spentRef.current === key) {
      return
    }
    const timer = setTimeout(() => setTimedOutKey(key), NOTIFICATION_TAB_GONE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [key, tabsLoaded, connected])
}
