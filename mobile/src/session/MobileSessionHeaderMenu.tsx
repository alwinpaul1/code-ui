import { useState } from 'react'
import { ConfirmModal } from '../components/ConfirmModal'
import { TextInputModal } from '../components/TextInputModal'
import { useClipboardWriter } from '../platform/clipboard'
import { MobileSessionHeaderMoreActionsSheet } from './MobileSessionHeaderMoreActionsSheet'
import { MobileCcrImagesSelfTest } from './MobileCcrImagesSelfTest'
import { sessionConnectionLine, sessionHeaderMenuActions } from './session-header-menu'
import { CCR_SESSION_WRITES, renameCcrSessionFromHeader } from './ccr-session-writes'
import { loadDefaultCcrPipelineDeps } from './use-ccr-session-images'
import type { MobileSessionController } from './use-mobile-session-controller'
import { useSessionHeaderMenu } from './use-session-header-menu'
import { useSessionHostName } from './use-session-host-name'

/**
 * The header's "…" menu and the dialogs its Rename and Archive open. The project screens (Agent
 * History, Checks, MCP Servers, Permission Rules, Project Memory) were already here; the Claude
 * app's session entries joined them (parity gap G35): Copy branch, Background tasks, Rename, Copy
 * session ID, each only when this session can offer it (session-header-menu.ts). Change model,
 * Archive and the connection line followed (Batch 3): Change model asks the chat for its own model
 * sheet, Archive asks first and then closes the active agent tab, and the line above the entries
 * reads Connected, Disconnected or Disconnected • Reconnect from <host>.
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
    openProjectMemory,
    hostId,
    connState,
    connectionVerdict,
    handleCloseSessionTab,
    nativeChatController
  } = controller
  const clipboard = useClipboardWriter()
  const sessionMenu = useSessionHeaderMenu(controller)
  const hostName = useSessionHostName(hostId)
  const connection = sessionConnectionLine({
    connState,
    // The phone's own verdict that it has stopped reaching the desktop: only then is "reconnect
    // from the desktop" the user's move (connection-health.ts).
    unreachable: connectionVerdict.kind === 'unreachable',
    hostName
  })
  // A Claude tab matched to its Anthropic session renames the session, as the app does, once the
  // write is proven (CCR_SESSION_WRITES); until then Rename is the workspace, as before.
  const anthropicSession = CCR_SESSION_WRITES ? (nativeChatController.nativeChatAnthropicSession ?? null) : null
  const actions = sessionHeaderMenuActions({
    client,
    worktreeId,
    branch: sessionMenu.branch,
    sessionId: sessionMenu.sessionId,
    clipboard,
    showToast,
    renameAnthropicSession: anthropicSession ? (name) => renameCcrSessionFromHeader(anthropicSession, name, loadDefaultCcrPipelineDeps) : null
  })
  // The name the dialog opened with, held while it is up: the dialog resets
  // what was typed whenever its default changes, and the live title can move
  // under it (a first worktree.show, or a worktreesChanged event).
  const [renaming, setRenaming] = useState<string | null>(null)
  const [checkingImages, setCheckingImages] = useState(false)
  // The tab Archive would close, held while its dialog is up so the answer closes the tab the
  // user was shown, not whichever tab is active by then.
  const [archiving, setArchiving] = useState<NonNullable<typeof sessionMenu.archiveTab> | null>(null)
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
        connection={connection}
        onCopyBranch={() => void actions.copyBranch()}
        onOpenBackgroundTasks={() => sessionMenu.openBackgroundTasks?.()}
        onChangeModel={() => nativeChatController.requestModelSheet()}
        onRename={() => setRenaming(anthropicSession?.title ?? worktreeName)}
        onArchive={() => setArchiving(sessionMenu.archiveTab)}
        onCopySessionId={() => void actions.copySessionId()}
        onCheckSessionImages={() => setCheckingImages(true)}
        onClose={() => setShowHeaderMoreActions(false)}
      />
      <MobileCcrImagesSelfTest visible={checkingImages} onClose={() => setCheckingImages(false)} />
      {/* The Claude app's Rename dialog, in its words. The name is the
          workspace's display name, or the Anthropic session's title once
          CCR_SESSION_WRITES is on. */}
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
      {/* The Claude app's Archive dialog (`archive_session_dialog_*`): its title and button.
          Its body promises a list of archived sessions, which Orca does not have, so this says
          what closing does. */}
      <ConfirmModal
        visible={archiving !== null}
        title="Archive session?"
        message="This closes the session’s tab on your computer."
        confirmLabel="Archive"
        destructive
        onConfirm={() => {
          const tab = archiving
          setArchiving(null)
          if (tab) {
            void handleCloseSessionTab(tab)
          }
        }}
        onCancel={() => setArchiving(null)}
      />
    </>
  )
}
