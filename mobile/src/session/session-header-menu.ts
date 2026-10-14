import type { ClipboardWriter } from '../platform/clipboard'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { resolveMobileTerminalTabAgentId } from './mobile-terminal-tab-agent'
import type { MobileSessionTab } from './mobile-session-route-types'
import { sessionWorkspaceRename } from './mobile-session-write-operations'

/**
 * The Claude app's session menu entries (com.anthropic.claude 1.261009.20, `us8` ~L282-357;
 * parity gap G35) that Orca's RPC lets the phone offer:
 *
 * - Copy branch: the workspace's branch, from the `worktree.show` record the title comes from.
 * - Background tasks: the chat's own Background tasks sheet, only while tasks run (the app's rule).
 * - Rename: the workspace display name, which is the header's title, through `worktree.set`.
 * - Copy session ID: the agent's own session id, as the agent stated it (an internal entry in the
 *   app; here it is the id `claude --resume` takes).
 * - Change model: opens the composer's own model sheet. The app's string (`session_menu_change_model`)
 *   is in 1.261009.20, but its entry class (`qou`) is abstract with no subclass, so the app's menu
 *   never lists it; it is here because the user asked for it. It sits where Share sits in the app.
 * - Archive: closes the active agent tab, the one end a tab has here. The app's own Archive moves a
 *   session to its archived list; Orca has no such list, so the dialog says what happens instead.
 *
 * Continue in cloud, Share and Feedback have no Orca path and are not offered.
 */
export type SessionHeaderMenuEntry =
  | 'copy-branch'
  | 'background-tasks'
  | 'change-model'
  | 'rename'
  | 'archive'
  | 'copy-session-id'

export function sessionHeaderMenuEntries(input: {
  /** Display branch name, null on a detached HEAD, a folder workspace or before the host answers. */
  branch: string | null
  runningTasks: number
  /** The chat's tasks provider is mounted and can open its sheet. */
  canOpenTasks: boolean
  /** The chat is showing and its composer has a model sheet to open. */
  canChangeModel: boolean
  canRename: boolean
  /** The active tab is an agent session this phone can close. */
  canArchive: boolean
  sessionId: string | null
}): SessionHeaderMenuEntry[] {
  const entries: SessionHeaderMenuEntry[] = []
  if (input.branch) {
    entries.push('copy-branch')
  }
  if (input.canOpenTasks && input.runningTasks > 0) {
    entries.push('background-tasks')
  }
  if (input.canChangeModel) {
    entries.push('change-model')
  }
  if (input.canRename) {
    entries.push('rename')
  }
  if (input.canArchive) {
    entries.push('archive')
  }
  if (input.sessionId?.trim()) {
    entries.push('copy-session-id')
  }
  return entries
}

/** The tab Archive closes: the active tab, when an agent runs in it. A plain shell, a browser, a
 *  file or a document is not a session, and no active tab means nothing to archive. */
export function archivableSessionTab(
  tabs: readonly MobileSessionTab[],
  activeTabId: string | null
): MobileSessionTab | null {
  const tab = activeTabId === null ? undefined : tabs.find((candidate) => candidate.id === activeTabId)
  if (!tab) {
    return null
  }
  if (tab.type === 'agent-session') {
    return tab
  }
  return tab.type === 'terminal' && resolveMobileTerminalTabAgentId(tab) !== null ? tab : null
}

export type SessionConnectionLine = { text: string; connected: boolean }

/**
 * The menu's connection line, in the app's words (`na20` ~L1003-1058): "Connected", "Disconnected",
 * and "Reconnect from <host>" after it.
 *
 * The app names a host to reconnect from when its computer dropped off; here that is the phone
 * having given up on the desktop (`unreachable`), and only when the desktop's name is known: a name
 * is never made up. While the phone is still dialling the line says Connecting…, as the app's
 * status line does (`et20` ~L449), not Disconnected.
 */
export function sessionConnectionLine(input: {
  connState: ConnectionState
  /** The phone has retried long enough that its verdict is "can't reach the desktop". */
  unreachable: boolean
  hostName: string | null
}): SessionConnectionLine {
  if (input.connState === 'connected') {
    return { text: 'Connected', connected: true }
  }
  const dialling =
    !input.unreachable &&
    (input.connState === 'connecting' ||
      input.connState === 'handshaking' ||
      input.connState === 'reconnecting')
  if (dialling) {
    return { text: 'Connecting…', connected: false }
  }
  const host = input.hostName?.trim()
  // A revoked pairing is not fixed by reconnecting from anywhere: it needs a new pairing.
  if (input.unreachable && host && input.connState !== 'auth-failed') {
    return { text: `Disconnected • Reconnect from ${host}`, connected: false }
  }
  return { text: 'Disconnected', connected: false }
}

export type SessionRenameOutcome = 'renamed' | 'refused' | 'failed'

/** Writes the workspace's display name. An empty name is refused here, never sent: Orca reads ''
 *  as "fall back to the branch or folder name", which is not what a rename means. */
export async function renameSessionWorkspace(
  client: RpcClient,
  worktreeId: string,
  name: string
): Promise<SessionRenameOutcome> {
  const displayName = name.trim()
  if (displayName === '') {
    return 'refused'
  }
  try {
    const reply = await sessionWorkspaceRename.request(client, {
      worktree: `id:${worktreeId}`,
      displayName
    })
    return sessionWorkspaceRename.interpret(reply).accepted ? 'renamed' : 'refused'
  } catch {
    return 'failed'
  }
}

/** What each entry does, with the words the Claude app uses ("Branch name copied", "Session ID
 *  copied"). A copy or rename that did not land says so; a dead tap is indistinguishable from a
 *  slow one. A rename that landed needs no toast: the title changes in front of the user. */
export function sessionHeaderMenuActions(deps: {
  client: RpcClient | null
  worktreeId: string
  branch: string | null
  sessionId: string | null
  clipboard: ClipboardWriter
  showToast: (message: string, durationMs?: number) => void
}) {
  const copy = async (value: string | null, done: string, failed: string) => {
    if (!value) {
      deps.showToast(failed, 1500)
      return
    }
    try {
      await deps.clipboard.writeText(value)
      deps.showToast(done)
    } catch {
      deps.showToast(failed, 1500)
    }
  }
  return {
    copyBranch: () => copy(deps.branch, 'Branch name copied', "Couldn't copy branch name"),
    copySessionId: () => copy(deps.sessionId, 'Session ID copied', "Couldn't copy session ID"),
    renameSession: async (name: string) => {
      const outcome = deps.client
        ? await renameSessionWorkspace(deps.client, deps.worktreeId, name)
        : 'failed'
      if (outcome !== 'renamed') {
        deps.showToast("Couldn't rename the session", 1500)
      }
    }
  }
}
