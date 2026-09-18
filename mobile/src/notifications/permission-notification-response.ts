import type { RpcClient } from '../transport/rpc-client'
import { mobileChatPermissionKey } from '../session/mobile-native-chat-permission'
import type { PendingPrompt } from './permission-lookup'

/** What a permission notification carries so its buttons can be answered. */
export type PermissionNotificationData = {
  hostId: string
  worktreeId: string
  /** Identity of the prompt the banner was BUILT from. */
  permissionKey: string
  /** Action identifier to the keystrokes that option sends. */
  sends: Record<string, string>
}

/** How a tap on a prompt banner's button ended. Shared by the permission and
 *  the question paths; only a question has an 'open-app' route. */
export type PromptAnswerOutcome =
  | 'sent'
  /** Not one of our buttons (the body, or a stranger's data): nothing to do here. */
  | 'not-an-answer'
  /** Our button, but its job is to bring the app up on the session, not to write. */
  | 'open-app'
  | 'unroutable'
  | 'offline'
  | 'stale'
  | 'failed'

export type PermissionAnswerOutcome = Exclude<PromptAnswerOutcome, 'open-app'>

function readData(value: unknown): PermissionNotificationData | null {
  if (value == null || typeof value !== 'object') {
    return null
  }
  const box = Object(value)
  const hostId: unknown = Reflect.get(box, 'hostId')
  const worktreeId: unknown = Reflect.get(box, 'worktreeId')
  const permissionKey: unknown = Reflect.get(box, 'permissionKey')
  const sends: unknown = Reflect.get(box, 'sends')
  if (
    typeof hostId !== 'string' ||
    typeof worktreeId !== 'string' ||
    typeof permissionKey !== 'string' ||
    sends == null ||
    typeof sends !== 'object'
  ) {
    return null
  }
  return { hostId, worktreeId, permissionKey, sends: sends as Record<string, string> }
}

/**
 * Answer a permission from its notification action.
 *
 * The re-check is the whole point, and it is not optional. A notification sits
 * in the shade until it is dismissed: by the time a thumb reaches Approve the
 * agent may have timed out, been answered at the desk, or moved on to asking
 * something else entirely. Sending the stored keystrokes blind would approve
 * whatever is on screen NOW — the user would be approving a command they never
 * saw, from a banner describing one they did.
 *
 * So the prompt is looked up again and compared by `mobileChatPermissionKey`,
 * which is identity by what is being ASKED rather than by how it was rendered.
 * A mismatch sends nothing. This mirrors the `expectedCodexPermission` recheck
 * the in-app card already performs before a shortcut, for the same reason.
 *
 * Never throws: this runs from a notification response handler, sometimes in a
 * headless context where a rejection reaches nobody.
 */
export async function answerPermissionFromNotification(args: {
  actionIdentifier: string
  data: unknown
  resolveClient: (hostId: string) => RpcClient | null
  lookup: (client: RpcClient, worktreeId: string) => Promise<PendingPrompt | null>
  send: (input: { client: RpcClient; terminal: string; text: string }) => Promise<boolean>
}): Promise<PermissionAnswerOutcome> {
  try {
    const data = readData(args.data)
    if (!data) {
      return 'not-an-answer'
    }
    const text = data.sends[args.actionIdentifier]
    // Android delivers the DEFAULT identifier when the body is tapped rather
    // than a button. That is "open the app", not "answer", and must not send.
    if (typeof text !== 'string' || text === '') {
      return 'not-an-answer'
    }
    const client = args.resolveClient(data.hostId)
    if (!client) {
      return 'unroutable'
    }
    if (client.getState() !== 'connected') {
      return 'offline'
    }
    const pending = await args.lookup(client, data.worktreeId)
    // A question arriving where the permission was is the same hazard as a
    // different permission: the stored digit would pick one of its options.
    if (
      !pending ||
      pending.kind !== 'permission' ||
      mobileChatPermissionKey(pending.permission) !== data.permissionKey
    ) {
      return 'stale'
    }
    // Why the option must still be on offer: an agent can re-ask the same
    // question with different choices, which passes the key check while the
    // stored keystrokes no longer mean what they did.
    if (!pending.permission.options.some((option) => option.send === text)) {
      return 'stale'
    }
    const sent = await args.send({ client, terminal: pending.terminal, text })
    return sent ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}
