import { useCallback } from 'react'
import { Platform } from 'react-native'
import { classifyConnection, verdictDisplayLabel } from '../transport/connection-health'
import { computeActiveTerminalKeyboardLift } from '../terminal/terminal-keyboard-avoidance-lift'
import { useInitialSessionTerminalAutoCreate } from './use-initial-session-terminal-autocreate'
import { MOBILE_SESSION_STATUS_LABELS } from './mobile-session-route-helpers'
import type { MobileSessionBulkCloseModel } from './use-mobile-session-bulk-close'
import { useLoadingConnectionTroubleState } from './loading-connection-trouble'
import { useSessionHostName } from './use-session-host-name'
import { useSessionRouteAgentHint } from './use-session-route-agent-hint'
import { mobileSessionLoadingScreen } from './mobile-session-loading-screen'

export function useMobileSessionPresentation(scope: MobileSessionBulkCloseModel) {
  const {
    hostId,
    created,
    worktreeId,
    router,
    insets,
    connState,
    client,
    reconnectAttempts,
    lastConnectedAt,
    terminalsLoaded,
    activeHandle,
    creating,
    creatingBrowser,
    creatingMarkdown,
    keyboardHeight,
    terminalKeyboardMetrics,
    toastOpacityRef,
    hostEndpoint,
    initialSessionAutoCreateRef,
    terminalFrameHeightRef,
    handleCreateTerminal,
    visibleTabs,
    forceReconnectHost,
    routeAgentParam
  } = scope
  const showLoadingState = connState === 'connected' && !terminalsLoaded && visibleTabs.length === 0
  // A workspace never opened on this phone has no cached tabs to say what it opens on; the row the
  // user tapped does (`?agent=claude`), until the tabs themselves arrive and the real one decides.
  const clearRouteAgentHint = useCallback(() => router.setParams({ agent: undefined }), [router])
  const routeAgentHint = useSessionRouteAgentHint({
    worktreeId,
    param: routeAgentParam,
    terminalsLoaded,
    clearParam: clearRouteAgentHint
  })
  // Before the first connection a workspace with nothing cached drew an empty terminal frame: it is
  // waiting on the host as much as "Loading tabs" is, so it draws the same loading screen, which
  // gives way to the connection's trouble once there is one (MobileSessionLoadingState.tsx).
  const sessionLoadingScreen = mobileSessionLoadingScreen({
    terminalsLoaded,
    visibleTabCount: visibleTabs.length,
    routeAgentHint
  })
  const showEmptyState =
    connState === 'connected' && terminalsLoaded && visibleTabs.length === 0 && !activeHandle

  // Why: a newly created workspace can hydrate with zero tabs before its first terminal exists.
  useInitialSessionTerminalAutoCreate({
    client,
    newlyCreatedWorkspace: created === '1',
    connState,
    terminalsLoaded,
    visibleTabCount: visibleTabs.length,
    activeHandle,
    createInFlight: creating || creatingBrowser || creatingMarkdown,
    stateRef: initialSessionAutoCreateRef,
    worktreeId,
    consumeCreationRoute: () => router.setParams({ created: undefined }),
    createTerminal: () => void handleCreateTerminal()
  })

  // Why: reconnect trickles to 90s at its give-up cap; surface tap-to-retry so recovery needn't wait it out (issue #5049).
  const connectionVerdict = classifyConnection({
    state: connState,
    reconnectAttempts,
    lastConnectedAt,
    endpoint: hostEndpoint
  })
  const connectionEscalated =
    connectionVerdict.kind === 'warning' || connectionVerdict.kind === 'unreachable'
  // Not on the page: the shell owns the connection and the tap could only do nothing.
  const showConnectionRetry = connectionEscalated && forceReconnectHost !== null
  // The same escalation, for the loading screens under this route (the chat's Clawd, its spinner):
  // they say it in place of loading forever, and go back to loading the moment it clears.
  const hostName = useSessionHostName(hostId)
  const loadingConnectionTroubleState = useLoadingConnectionTroubleState(
    connectionVerdict,
    hostName,
    hostId,
    forceReconnectHost
  )

  const terminalSummary =
    connState === 'connected'
      ? showLoadingState
        ? 'Loading tabs'
        : visibleTabs.length === 1
          ? '1 tab'
          : `${visibleTabs.length} tabs`
      : showConnectionRetry
        ? `${verdictDisplayLabel(connectionVerdict)} — tap to retry`
        : connectionEscalated
          ? verdictDisplayLabel(connectionVerdict)
          : MOBILE_SESSION_STATUS_LABELS[connState]

  // Why: iOS keyboard height includes the home-indicator inset; Android IME height does not.
  const keyboardLift =
    keyboardHeight > 0
      ? Platform.OS === 'ios'
        ? Math.max(0, keyboardHeight - insets.bottom)
        : keyboardHeight
      : 0
  const activeTerminalKeyboardLift = computeActiveTerminalKeyboardLift({
    keyboardLift,
    metrics: activeHandle ? terminalKeyboardMetrics.get(activeHandle) : undefined,
    terminalFrameHeight: terminalFrameHeightRef.current
  })
  const toastAnimatedStyle = {
    opacity: toastOpacityRef.current,
    transform: [{ translateY: -keyboardLift }]
  }
  return {
    showLoadingState,
    sessionLoadingScreen,
    showEmptyState,
    connectionVerdict,
    showConnectionRetry,
    loadingConnectionTroubleState,
    terminalSummary,
    keyboardLift,
    activeTerminalKeyboardLift,
    toastAnimatedStyle
  }
}

export type MobileSessionPresentationModel = MobileSessionBulkCloseModel &
  ReturnType<typeof useMobileSessionPresentation>
