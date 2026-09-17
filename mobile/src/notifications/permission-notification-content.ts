import type { MobileChatPermission } from '../session/mobile-native-chat-permission'

export type PermissionNotificationAction = {
  /** What Android hands back when the action is tapped. */
  identifier: string
  label: string
  /** The keystrokes the agent's prompt expects for this option. */
  send: string
}

export type PermissionNotificationContent = {
  title: string
  body: string
  actions: PermissionNotificationAction[]
}

/**
 * Android draws at most three actions on a notification and silently drops the
 * rest, so which three survive is decided here rather than by the OS.
 */
const MAX_ACTIONS = 3

/** Identity is the INDEX, never the label: Android returns only this string, and
 *  an agent may label two options almost alike ("Yes" / "Yes, and don't ask
 *  again"). An index cannot collide and does not change between prompts. */
function actionIdentifier(index: number): string {
  return `permission:${index}`
}

/**
 * What the shade should show for a pending permission, or null when it cannot
 * be answered from there.
 *
 * Built from the PERMISSION, never from the desktop's notification body. That
 * body is composed on the desktop out of recent terminal output, which is why
 * a permission ask arrived captioned with the previous command's stdout.
 *
 * Null is a real answer: a permission with nothing to send cannot be acted on
 * from a banner, and a banner offering buttons that do nothing is worse than
 * the plain one it would replace. The caller keeps the desktop's notification.
 */
export function permissionNotificationContent(
  permission: MobileChatPermission
): PermissionNotificationContent | null {
  const title = permission.title.trim()
  if (title === '') {
    return null
  }
  const sendable = permission.options
    .map((option, index) => ({
      identifier: actionIdentifier(index),
      label: option.label,
      send: option.send
    }))
    .filter((action) => action.send !== '' && action.label.trim() !== '')
  if (sendable.length === 0) {
    return null
  }
  // The command is what the user is actually approving, and what Claude's own
  // banner shows; the summary is a paraphrase of it.
  const body = (permission.command ?? permission.detail ?? '').trim()
  return {
    title,
    body: body === '' ? title : body,
    actions: keepWithinAndroidLimit(sendable)
  }
}

/**
 * Keep the first options and the last one.
 *
 * The last is the refusal in every prompt shape seen here — Escape for the
 * approval envelope, the highest number for a numbered list — and dropping the
 * ability to say no while keeping three ways to say yes is the wrong trade.
 * Each action keeps the identifier of its ORIGINAL index, so what is sent still
 * matches the option the agent is waiting on.
 */
function keepWithinAndroidLimit(
  actions: PermissionNotificationAction[]
): PermissionNotificationAction[] {
  if (actions.length <= MAX_ACTIONS) {
    return actions
  }
  return [...actions.slice(0, MAX_ACTIONS - 1), actions[actions.length - 1]!]
}
