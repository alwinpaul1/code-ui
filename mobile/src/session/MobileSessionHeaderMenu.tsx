import { useState } from 'react'
import { TextInputModal } from '../components/TextInputModal'
import { useClipboardWriter } from '../platform/clipboard'
import { MobileSessionHeaderMoreActionsSheet } from './MobileSessionHeaderMoreActionsSheet'
import { MobileCcrImagesSelfTest } from './MobileCcrImagesSelfTest'
import { sessionHeaderMenuActions } from './session-header-menu'
import type { MobileSessionController } from './use-mobile-session-controller'
import { useSessionHeaderMenu } from './use-session-header-menu'

/**
 * The header's "…" menu and the dialog its Rename opens. The project screens (Agent History,
 * Checks, MCP Servers, Permission Rules, Project Memory) were already here; the Claude app's
 * session entries joined them (parity gap G35): Copy branch, Background tasks, Rename, Copy
 * session ID, each only when this session can offer it (session-header-menu.ts).
 */
export function MobileSessionHeaderMenu({ controller }: { controller: MobileSessionController }) {
  const {
    client,
    worktreeId,
    worktreeName,
    showToast,
    showHeaderMoreActions,
    setShowHeaderMoreActions,
    handlePanelTap,
    openAgentSessionHistory,
    showAgentSessionHistoryAction,
    showChecksAction,
    showProjectConfigActions,
    openMcpServers,
    openPermissionRules,
    openProjectMemory
  } = controller
  const clipboard = useClipboardWriter()
  const sessionMenu = useSessionHeaderMenu(controller)
  const actions = sessionHeaderMenuActions({
    client,
    worktreeId,
    branch: sessionMenu.branch,
    sessionId: sessionMenu.sessionId,
    clipboard,
    showToast
  })
  // The name the dialog opened with, held while it is up: the dialog resets
  // what was typed whenever its default changes, and the live title can move
  // under it (a first worktree.show, or a worktreesChanged event).
  const [renaming, setRenaming] = useState<string | null>(null)
  const [checkingImages, setCheckingImages] = useState(false)
  return (
    <>
      <MobileSessionHeaderMoreActionsSheet
        visible={showHeaderMoreActions}
        showAgentSessionHistory={showAgentSessionHistoryAction}
        showChecks={showChecksAction}
        showProjectConfigActions={showProjectConfigActions}
        onOpenAgentSessionHistory={openAgentSessionHistory}
        onOpenChecks={() => handlePanelTap('pr')}
        onOpenMcpServers={openMcpServers}
        onOpenPermissionRules={openPermissionRules}
        onOpenProjectMemory={openProjectMemory}
        sessionEntries={sessionMenu.entries}
        onCopyBranch={() => void actions.copyBranch()}
        onOpenBackgroundTasks={() => sessionMenu.openBackgroundTasks?.()}
        onRename={() => setRenaming(worktreeName)}
        onCopySessionId={() => void actions.copySessionId()}
        onCheckSessionImages={() => setCheckingImages(true)}
        onClose={() => setShowHeaderMoreActions(false)}
      />
      <MobileCcrImagesSelfTest visible={checkingImages} onClose={() => setCheckingImages(false)} />
      {/* The Claude app's Rename dialog, in its words. The name is the
          workspace's own display name, which is the header's title. */}
      <TextInputModal
        visible={renaming !== null}
        title="Rename session"
        message="Enter a new name for this session"
        defaultValue={renaming ?? worktreeName}
        placeholder="Enter session name"
        submitLabel="Save"
        selectTextOnFocus
        onSubmit={(value) => {
          setRenaming(null)
          void actions.renameSession(value)
        }}
        onCancel={() => setRenaming(null)}
      />
    </>
  )
}
