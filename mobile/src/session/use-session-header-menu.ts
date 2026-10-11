import { useMemo } from 'react'
import { displayBranchName } from './session-header-display'
import { sessionHeaderMenuEntries } from './session-header-menu'
import { useHeaderBackgroundTasks } from './session-header-tasks-bridge'
import type { MobileSessionController } from './use-mobile-session-controller'

/**
 * The header menu's session entries for this screen, read by both the header (whether to draw the
 * "…" at all) and the sheets (what the menu lists), so the two cannot disagree.
 *
 * Rename is offered on git workspaces only: the floating terminal workspace has no record to
 * rename, and a folder workspace's record is not proven to take `worktree.set` here.
 */
export function useSessionHeaderMenu(controller: MobileSessionController) {
  const tasks = useHeaderBackgroundTasks()
  const branch = displayBranchName(controller.worktreeBranch)
  const { activeChatEligible, nativeChatSessionIdentity } = controller.nativeChatController
  const sessionId = activeChatEligible ? (nativeChatSessionIdentity?.sessionId ?? null) : null
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
        canRename,
        sessionId
      }),
    [branch, tasks.runningCount, tasks.open, canRename, sessionId]
  )
  return { entries, branch, sessionId, openBackgroundTasks: tasks.open }
}
