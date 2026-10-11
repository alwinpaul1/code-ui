import type { ClipboardWriter } from '../platform/clipboard'
import type { RpcClient } from '../transport/rpc-client'
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
 *
 * Continue in cloud, Share and Feedback have no Orca path and are not offered.
 */
export type SessionHeaderMenuEntry = 'copy-branch' | 'background-tasks' | 'rename' | 'copy-session-id'

export function sessionHeaderMenuEntries(input: {
  /** Display branch name, null on a detached HEAD, a folder workspace or before the host answers. */
  branch: string | null
  runningTasks: number
  /** The chat's tasks provider is mounted and can open its sheet. */
  canOpenTasks: boolean
  canRename: boolean
  sessionId: string | null
}): SessionHeaderMenuEntry[] {
  const entries: SessionHeaderMenuEntry[] = []
  if (input.branch) {
    entries.push('copy-branch')
  }
  if (input.canOpenTasks && input.runningTasks > 0) {
    entries.push('background-tasks')
  }
  if (input.canRename) {
    entries.push('rename')
  }
  if (input.sessionId?.trim()) {
    entries.push('copy-session-id')
  }
  return entries
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
