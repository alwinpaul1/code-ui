import { useRef, useCallback } from 'react'
import { Linking } from 'react-native'
import { useMobileFileTapHandlers } from './use-mobile-file-tap-handlers'
import { resolveMobileNativeChatFileSessionId } from './mobile-native-chat-eligibility'
import { activateOpenedSourceControlDiffTab } from './opened-mobile-session-tab'
import { planFileReaderAskAboutLines } from './mobile-file-reader-ask-about-lines-plan'
import type { FileReaderLineRange } from './mobile-file-reader-line-selection'
import type { MobileSessionTab } from './mobile-session-route-types'
import type { MobileSessionTerminalSendActionsModel } from './use-mobile-session-terminal-send-actions'

export function useMobileSessionFileActions(scope: MobileSessionTerminalSendActionsModel) {
  const {
    hostId,
    worktreeId,
    routeWorktreeName,
    isFloatingWorkspaceRoute,
    client,
    sessionTabsRef,
    terminalLinkOpenMode,
    activeSessionTabIdRef,
    terminalCwdRef,
    activeHandleRef,
    activeSessionTab,
    activeSessionTabTypeRef,
    switchSessionTabRef,
    handleCreateBrowserRef,
    scheduleDelayedAction,
    nativeChatSendError,
    fetchSessionTabs,
    nativeChatController,
    nativeChatTranscriptIsLocalReadable,
    visitedSessionTabIdsRef
  } = scope
  // Tap a terminal or chat file path → resolve on host, open as file tab/preview.
  const { handleFileTap, handleNativeChatFileTap } = useMobileFileTapHandlers<MobileSessionTab>({
    client,
    hostId,
    worktreeId,
    worktreeName: routeWorktreeName,
    nativeChatSessionId: resolveMobileNativeChatFileSessionId(activeSessionTab),
    activeHandleRef,
    terminalCwdRef,
    openBrowser: (url) => void handleCreateBrowserRef.current?.(url),
    fetchSessionTabs,
    getSessionTabs: () => sessionTabsRef.current,
    getActiveSessionTabId: () => activeSessionTabIdRef.current,
    getActiveSessionTabType: () => activeSessionTabTypeRef.current,
    switchSessionTab: (tab) => switchSessionTabRef.current?.(tab),
    scheduleDelayedAction,
    reportChatTapFailure: nativeChatSendError.show
  })

  const handleOpenedFileDiffActivationSeqRef = useRef(0)
  // Capture active tab at tap time; reading it after openDiff would misread a mid-RPC switch and let the retry steal focus.
  const fileOpenStartActiveTabIdRef = useRef<string | null>(null)
  const handleFileOpenStart = useCallback(() => {
    fileOpenStartActiveTabIdRef.current = activeSessionTabIdRef.current
  }, [])
  const handleOpenedFileDiff = useCallback(
    (relativePath: string) => {
      const activationSeq = ++handleOpenedFileDiffActivationSeqRef.current
      const activeTabIdAtTap = fileOpenStartActiveTabIdRef.current

      let activated = false
      const activateOpenedTab = async (): Promise<void> => {
        // Route matching through the shared helper so the repro test exercises the same logic production runs.
        const settled = await activateOpenedSourceControlDiffTab<MobileSessionTab>({
          relativePath,
          activeTabIdAtTap,
          fetchSessionTabs,
          getTabs: () => sessionTabsRef.current,
          getActiveTabId: () => activeSessionTabIdRef.current,
          getActivationState: () => ({
            activated,
            activationSeq,
            latestActivationSeq: handleOpenedFileDiffActivationSeqRef.current
          }),
          switchSessionTab: (tab) => switchSessionTabRef.current?.(tab)
        })
        if (settled) {
          activated = true
        }
      }

      scheduleDelayedAction(() => void activateOpenedTab(), 300)
      scheduleDelayedAction(() => void activateOpenedTab(), 900)
      scheduleDelayedAction(() => void activateOpenedTab(), 1800)
    },
    [fetchSessionTabs, scheduleDelayedAction]
  )

  const handleTerminalOpenUrl = useCallback(
    (handle: string, url: string) => {
      if (handle !== activeHandleRef.current) {
        return
      }
      // Why: browser.tabCreate resolves a real worktree, which the floating
      // sentinel doesn't have — open taps in the phone browser instead.
      if (terminalLinkOpenMode === 'phone-browser' || isFloatingWorkspaceRoute) {
        void Linking.openURL(url).catch(() => {})
        return
      }
      void handleCreateBrowserRef.current?.(url)
    },
    [terminalLinkOpenMode, isFloatingWorkspaceRoute]
  )
  // Alt+K parity: the file reader's "Ask about lines"/"Ask about file" — plan
  // where it lands (see planFileReaderAskAboutLines for the tab/agent/mention
  // decision), write the mention into that tab's draft even though it isn't
  // the active tab yet, then switch to it with the composer focused.
  const askAboutFileLines = useCallback(
    (relativePath: string, range: FileReaderLineRange | null) => {
      const plan = planFileReaderAskAboutLines({
        relativePath,
        range,
        tabs: sessionTabsRef.current,
        visitHistory: visitedSessionTabIdsRef.current,
        currentTabId: activeSessionTabIdRef.current,
        nativeChatTranscriptIsLocalReadable
      })
      if (!plan) {
        nativeChatSendError.show('No chat is open to ask about this file')
        return
      }
      nativeChatController.appendComposerMention(plan.targetTab.id, plan.mention)
      switchSessionTabRef.current?.(plan.targetTab)
      if (plan.targetTab.type === 'terminal' && !nativeChatController.isTabChatView(plan.targetTab.id, plan.agent)) {
        nativeChatController.toggleTabChatView(plan.targetTab.id, plan.agent)
      }
      nativeChatController.requestComposerFocus()
    },
    [nativeChatController, nativeChatSendError, nativeChatTranscriptIsLocalReadable]
  )
  return {
    handleFileTap,
    handleNativeChatFileTap,
    handleOpenedFileDiffActivationSeqRef,
    fileOpenStartActiveTabIdRef,
    handleFileOpenStart,
    handleOpenedFileDiff,
    handleTerminalOpenUrl,
    askAboutFileLines
  }
}

export type MobileSessionFileActionsModel = MobileSessionTerminalSendActionsModel &
  ReturnType<typeof useMobileSessionFileActions>
