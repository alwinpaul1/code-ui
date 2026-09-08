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

/** An answered prompt must not fall back to a sticky hook summary. This was
 *  scoped to 'Allow Bash?' — the one dialog the screen parser names — so every
 *  other approval kept its card, carrying digits scraped off the screen, until
 *  the tool run ended. Answering an Edit prompt on the desktop and then tapping
 *  the card wrote that digit into whatever dialog had replaced it. Dismissal is
 *  only ever set after a dialog was seen and then left the screen, so it is
 *  evidence about this prompt whatever the prompt was called. */
export function resolveObservedPermission(
  screen: MobileChatPermission | null,
  reported: MobileChatPermission | null,
  dismissed: boolean
): MobileChatPermission | null {
  return screen ?? (dismissed ? null : reported)
}
