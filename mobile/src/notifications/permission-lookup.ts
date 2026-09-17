import type { RpcClient } from '../transport/rpc-client'
import { parseApprovalFromStatus } from '../session/mobile-native-chat-permission'
import type { MobileChatPermission } from '../session/mobile-native-chat-permission'
import { permissionAgentStatus, permissionTerminalList } from './permission-lookup-operations'

/**
 * How many agent terminals in one worktree are worth asking. A worktree with
 * more than this running at once is possible, and asking all of them would make
 * a notification wait on a fan-out for a prompt that is almost certainly in the
 * first one or two.
 */
const MAX_TERMINALS_QUERIED = 4

/**
 * The permission an agent in this worktree is waiting on, or null.
 *
 * Why this has to ask the host at all: the notification event carries a title,
 * a body and some ids, and nothing about what is being asked. The desktop HAS
 * the answer — `NotificationDispatchRequest` has `agentToolName` and
 * `agentToolInput` — but does not forward them, and the desktop is stock Orca.
 * The permission itself lives in `agentStatus.interactivePrompt`, which the
 * phone otherwise only sees through the subscription belonging to an open
 * session screen. With the app closed, which is when a notification matters,
 * nothing on the phone knows what Claude wants.
 *
 * Asking is safe at this moment specifically: the notification arrived over the
 * link, so the link is up by definition.
 *
 * Every failure returns null and the caller shows the desktop's own
 * notification. A decorated banner is an improvement, never a requirement, and
 * a permission ask that never appears because a lookup threw would be a far
 * worse bug than the plain caption it replaced.
 */
export type PendingPermission = {
  permission: MobileChatPermission
  /** The terminal the prompt is waiting in — an answer has to go back to it,
   *  and a worktree can hold several agents. */
  terminal: string
}

export async function lookupPendingPermission(
  client: RpcClient,
  worktreeId: string
): Promise<PendingPermission | null> {
  try {
    if (client.getState() !== 'connected') {
      return null
    }
    const terminals = permissionTerminalList.interpret(
      await permissionTerminalList.request(client, {
        worktree: worktreeId,
        // Why: a stale handle answers agentStatus for a PTY that has gone, and
        // the prompt it reports belongs to nothing.
        requireFreshPtyLiveness: true
      })
    )
    if (terminals === null) {
      return null
    }
    const candidates = terminals.filter((terminal) => terminal.hasAgent).slice(0, MAX_TERMINALS_QUERIED)
    for (const terminal of candidates) {
      const prompt = permissionAgentStatus.interpret(
        await permissionAgentStatus.request(client, { terminal: terminal.handle })
      )
      const permission = parseApprovalFromStatus(prompt)
      if (permission) {
        return { permission, terminal: terminal.handle }
      }
    }
    return null
  } catch {
    return null
  }
}
