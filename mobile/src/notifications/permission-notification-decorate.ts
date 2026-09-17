import { mobileChatPermissionKey } from '../session/mobile-native-chat-permission'
import type { RpcClient } from '../transport/rpc-client'
import type { PendingPermission } from './permission-lookup'
import { permissionNotificationContent } from './permission-notification-content'
import type { PermissionNotificationData } from './permission-notification-response'

export type DecoratableContent = {
  title?: string
  body?: string
  data?: Record<string, unknown>
  /** Set only when the OS accepted an action set; Android draws buttons from a
   *  category rather than from the notification itself. */
  categoryIdentifier?: string
}

export type PermissionDecorationDeps = {
  resolveClient: (hostId: string) => RpcClient | null
  lookup: (client: RpcClient, worktreeId: string) => Promise<PendingPermission | null>
  /** Registers the action set with the OS and resolves to its category id. */
  ensureCategory: (actions: { identifier: string; label: string }[]) => Promise<string | null>
}

/**
 * Replace a notification's caption with the permission it is actually about,
 * and hang Approve/Deny on it.
 *
 * Why the caption needs replacing at all: the desktop composes the body from
 * recent terminal output, so a permission ask arrived captioned with the
 * PREVIOUS command's stdout — "Exit code 1 pages=2 pageheight=841.89 pdftotext
 * version 4.00 Copyright..." next to Claude's own banner naming the tool and
 * showing the command. The desktop has the right fields (`agentToolName`,
 * `agentToolInput`) and does not forward them, and it is stock Orca, so the
 * phone asks for itself.
 *
 * Returns the content UNCHANGED on every failure. The decoration is an
 * improvement on a notification that already works; a permission ask that never
 * appeared because a lookup was slow or refused would be a far worse bug than
 * the wrong caption it was meant to fix.
 */
export async function decorateWithPermission(
  content: DecoratableContent,
  event: { worktreeId?: string },
  hostId: string,
  deps: PermissionDecorationDeps
): Promise<DecoratableContent> {
  try {
    const worktreeId = event.worktreeId
    if (!worktreeId) {
      // Without it there is nothing to ask about and nowhere to send an answer.
      return content
    }
    const client = deps.resolveClient(hostId)
    if (!client) {
      return content
    }
    const pending = await deps.lookup(client, worktreeId)
    if (!pending) {
      return content
    }
    const permission = permissionNotificationContent(pending.permission)
    if (!permission) {
      return content
    }
    const categoryIdentifier = await deps.ensureCategory(
      permission.actions.map((action) => ({ identifier: action.identifier, label: action.label }))
    )
    if (!categoryIdentifier) {
      // The buttons are the point. Without them, the caption alone is still an
      // improvement, so keep it and drop only the actions.
      return { ...content, title: permission.title, body: permission.body }
    }
    const answerData: PermissionNotificationData = {
      hostId,
      worktreeId,
      // Identity of the prompt this banner was built from, so a tap minutes
      // later can tell whether the agent is still asking the same thing.
      permissionKey: mobileChatPermissionKey(pending.permission),
      sends: Object.fromEntries(permission.actions.map((a) => [a.identifier, a.send]))
    }
    return {
      ...content,
      title: permission.title,
      body: permission.body,
      categoryIdentifier,
      data: { ...content.data, ...answerData }
    }
  } catch {
    return content
  }
}
