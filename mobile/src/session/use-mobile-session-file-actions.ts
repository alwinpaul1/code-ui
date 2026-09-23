import { useRef, useCallback } from 'react'
import { openExternalLink } from '../platform/external-link'
import { useMobileFileTapHandlers } from './use-mobile-file-tap-handlers'
import { useMobileNativeChatHunkRevert } from './use-mobile-native-chat-hunk-revert'
import { resolveMobileNativeChatFileSessionId } from './mobile-native-chat-eligibility'
import { activateOpenedSourceControlDiffTab } from './opened-mobile-session-tab'
import { planFileReaderAskAboutLines } from './mobile-file-reader-ask-about-lines-plan'
import { planTerminalAskAboutScreen } from './mobile-terminal-ask-about-screen-plan'
import { buildTerminalScreenFenceBlock } from './mobile-terminal-ask-about-screen'
import { terminalScreenLinesRead } from './mobile-terminal-ask-about-screen-operations'
import type { ChatTargetTab } from './mobile-chat-target-tab'
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
  // "Revert this hunk" on a landed-edit card: the same worktree and chat
  // provenance a tapped path resolves with, so the two cannot disagree about
  // which file a card names. Undefined until this host is known to let a
  // phone call files.write.
  const handleNativeChatRevertHunk = useMobileNativeChatHunkRevert({
    client,
    hostId,
    worktreeId,
    nativeChatSessionId: resolveMobileNativeChatFileSessionId(activeSessionTab),
    getActiveSessionTabId: () => activeSessionTabIdRef.current
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
        openExternalLink(url)
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

  // "Ask about this screen" (session menu, TUI-lane terminal tabs; VS Code
  // 2.1.275's "Send terminal output to Claude" parity). Where the text lands
  // is decided synchronously (planTerminalAskAboutScreen, no RPC) so the
  // session menu can omit the entry when there is nowhere for it to go; only
  // the screen read itself is async.
  const resolveAskAboutScreenTarget = useCallback(
    (terminalTabId: string | null | undefined): ChatTargetTab | null =>
      planTerminalAskAboutScreen({
        tabs: sessionTabsRef.current,
        visitHistory: visitedSessionTabIdsRef.current,
        terminalTabId: terminalTabId ?? null,
        nativeChatTranscriptIsLocalReadable
      }),
    [nativeChatTranscriptIsLocalReadable]
  )
  const askAboutTerminalScreen = useCallback(
    async (target: { handle: string }) => {
      if (!client) {
        return
      }
      const sourceTab = sessionTabsRef.current.find(
        (tab) => tab.type === 'terminal' && tab.terminal === target.handle
      )
      const plan = resolveAskAboutScreenTarget(sourceTab?.id ?? null)
      if (!plan) {
        nativeChatSendError.show('No chat is open to ask about this screen')
        return
      }
      let lines: string[] | null = null
      try {
        lines = terminalScreenLinesRead.interpret(
          await terminalScreenLinesRead.request(client, { terminal: target.handle, screen: true })
        )
      } catch {
        lines = null
      }
      // An empty (or blank end to end) screen: nothing to append, no error —
      // there is genuinely nothing wrong, just nothing to ask about yet.
      const block = buildTerminalScreenFenceBlock(lines ?? [])
      if (!block) {
        return
      }
      nativeChatController.appendComposerMention(plan.targetTab.id, block)
      switchSessionTabRef.current?.(plan.targetTab)
      if (
        plan.targetTab.type === 'terminal' &&
        !nativeChatController.isTabChatView(plan.targetTab.id, plan.agent)
      ) {
        nativeChatController.toggleTabChatView(plan.targetTab.id, plan.agent)
      }
      nativeChatController.requestComposerFocus()
    },
    [client, nativeChatController, nativeChatSendError, resolveAskAboutScreenTarget]
  )

  return {
    handleFileTap,
    handleNativeChatFileTap,
    handleNativeChatRevertHunk,
    handleOpenedFileDiffActivationSeqRef,
    fileOpenStartActiveTabIdRef,
    handleFileOpenStart,
    handleOpenedFileDiff,
    handleTerminalOpenUrl,
    askAboutFileLines,
    resolveAskAboutScreenTarget,
    askAboutTerminalScreen
  }
}

export type MobileSessionFileActionsModel = MobileSessionTerminalSendActionsModel &
  ReturnType<typeof useMobileSessionFileActions>
