import { useMemo } from 'react'
import { displayBranchName } from './session-header-display'
import { archivableSessionTab, sessionHeaderMenuEntries } from './session-header-menu'
import { useHeaderBackgroundTasks } from './session-header-tasks-bridge'
import type { MobileSessionController } from './use-mobile-session-controller'

/**
 * The header menu's session entries for this screen, read by both the header (whether to draw the
 * "…" at all) and the sheets (what the menu lists), so the two cannot disagree.
 *
 * Rename is offered on repository workspaces only: the floating terminal workspace has no record
 * to rename, and a folder workspace's record is not proven to take `worktree.set` here.
 *
 * Change model is offered while the chat is showing and its composer has a model option to open
 * (the sheet is part of the chat view, so a terminal view has nothing to open). Archive is offered
 * for the active tab when an agent runs in it: `archiveTab` is the tab it closes.
 */
export function useSessionHeaderMenu(controller: MobileSessionController) {
  const tasks = useHeaderBackgroundTasks()
  const branch = displayBranchName(controller.worktreeBranch)
  const { activeChatEligible, nativeChatSessionIdentity, showNativeChat, nativeChatSessionOptions } =
    controller.nativeChatController
  const sessionId = activeChatEligible ? (nativeChatSessionIdentity?.sessionId ?? null) : null
  const canChangeModel =
    showNativeChat &&
    (nativeChatSessionOptions?.controller.snapshot.some(
      (descriptor) => descriptor.category === 'model'
    ) ??
      false)
  const archiveTab = archivableSessionTab(controller.visibleTabs, controller.activeSessionTabId)
  const canArchive = archiveTab !== null && controller.client !== null
  const canRename =
    !controller.isFolderWorkspaceRoute &&
    !controller.isFloatingWorkspaceRoute &&
    controller.client !== null
  const entries = useMemo(
    () =>
      sessionHeaderMenuEntries({
        branch,
        runningTasks: tasks.runningCount,
        canOpenTasks: tasks.open !== null,
        canChangeModel,
        canRename,
        canArchive,
        sessionId
      }),
    [branch, tasks.runningCount, tasks.open, canChangeModel, canRename, canArchive, sessionId]
  )
  return {
    entries,
    branch,
    sessionId,
    openBackgroundTasks: tasks.open,
    archiveTab: canArchive ? archiveTab : null
  }
}
