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

/** Why the chat says the agent is waiting in the terminal: the screen draws a
 *  dialog (with these choices), or only the host's hook status says so. */
export type NativeChatTerminalWait = { source: 'screen'; choices: string[] } | { source: 'hook' }

/**
 * The agent is waiting on a prompt the chat has no card for. On 2026-09-27 a
 * background subagent's Bash prompt went unread for eight hours: the screen
 * parser refused its title, the hook status carried no card, and the chat said
 * nothing at all, so a stuck agent looked like a busy one. A prompt the phone
 * cannot read must still be announced, with nothing to tap but the way to it.
 *
 * The screen's numbered Yes…/No… choices are the same "a prompt is on screen"
 * signal the dismissal tracking uses, and they are drawn by every dialog of
 * both agents whatever its title says. The hook's waiting/blocked state speaks
 * for a prompt the screen read has not seen, but not for one the screen saw
 * leave: the hook's row outlives its answer.
 */
export function terminalPromptWait(input: {
  /** The card the chat shows for a prompt: permission, question or ask. */
  card: unknown
  dialogOptions: MobileChatPermission['options'] | null
  /** A dialog was seen on screen and has since left it. */
  dialogLeft: boolean
  hookState: string | null | undefined
}): NativeChatTerminalWait | null {
  if (input.card != null) {
    return null
  }
  if (input.dialogOptions != null) {
    return { source: 'screen', choices: input.dialogOptions.map((option) => option.label) }
  }
  const waiting = input.hookState === 'waiting' || input.hookState === 'blocked'
  return waiting && !input.dialogLeft ? { source: 'hook' } : null
}
