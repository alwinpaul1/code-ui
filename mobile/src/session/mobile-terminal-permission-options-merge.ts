import type { MobileChatPermission } from './mobile-native-chat-permission'

/** The card built from the host's approval envelope only knows Allow/Deny; when
 *  the terminal screen shows the dialog's real options, use those instead. */
export function withTerminalDialogOptions(
  permission: MobileChatPermission | null,
  dialogOptions: MobileChatPermission['options'] | null
): MobileChatPermission | null {
  if (!permission || !dialogOptions) {
    return permission
  }
  return { ...permission, options: dialogOptions }
}
