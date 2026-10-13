import { useCallback } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { firstParam } from '../navigation/route-param-reader'
import { useNotificationTabRequest, type NotificationTabRequest } from './notification-tab-request'
import type { MobileSessionTabSwitchingModel } from './use-mobile-session-tab-switching'

/** Said when the tab a notification came from has closed since: the workspace
 *  opens on its current tab, and the user is told why it is not the one they
 *  tapped, rather than left on a tab that looks like a wrong landing. */
export const NOTIFICATION_TAB_GONE_MESSAGE = 'The tab that sent this notification has closed'

/**
 * Selects the tab a notification tap named in this screen's route (`paneKey`
 * for a terminal pane, `agentSessionId` for a structured agent session), and
 * clears the param once it has been applied. See notification-tab-request.ts.
 */
export function useMobileSessionNotificationTab(scope: MobileSessionTabSwitchingModel): void {
  const params = useLocalSearchParams<{
    paneKey?: string | string[]
    agentSessionId?: string | string[]
  }>()
  const paneKey = firstParam(params.paneKey)
  const agentSessionId = firstParam(params.agentSessionId)
  const request: NotificationTabRequest | null =
    paneKey !== '' ? { paneKey } : agentSessionId !== '' ? { agentSessionId } : null
  const { router, showToast, worktreeId, sessionTabs, terminalsLoaded, switchSessionTab } = scope
  const onTabGone = useCallback(
    () => showToast(NOTIFICATION_TAB_GONE_MESSAGE, 3000),
    [showToast]
  )
  // Written empty rather than removed, as the route file's own clear does: a
  // cleared key and a key that was never there are the same route.
  const clearRequest = useCallback(() => {
    router.setParams(paneKey !== '' ? { paneKey: '' } : { agentSessionId: '' })
  }, [paneKey, router])
  useNotificationTabRequest({
    worktreeId,
    request,
    sessionTabs,
    tabsLoaded: terminalsLoaded,
    switchSessionTab,
    onTabGone,
    clearRequest
  })
}
