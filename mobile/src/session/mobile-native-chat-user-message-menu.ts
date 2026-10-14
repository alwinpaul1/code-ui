// What a hold on a sent message offers, after the Claude app's message menu
// (com.anthropic.claude 1.261009.20, gv20.java:583-860). The app draws, in this
// order and each only when it applies: "Send now" and "Undo send" for a message
// still waiting, then "Copy message" and "Select text", then Edit and Retry for
// the messages it can edit or retry. Code UI offers the three that Claude Code
// has a way to carry out:
//
//   Undo send       a waiting message: the echo queued behind a running turn
//                   goes back out of the queue (the same as its Cancel)
//   Copy message    the words as typed
//   Select text     the words in a sheet of their own, selectable
//
// Not offered: Send now (Claude Code delivers a queued message between tool
// calls on its own, there is no key that makes it go sooner), Edit (the Claude
// app has none on Code sessions either) and Retry.
//
// Strings (res/values/strings.xml): chat_message_bottom_sheet_menu_copy "Copy
// message", chat_message_bottom_sheet_menu_select "Select text",
// chat_waiting_message_menu_undo_send "Undo send".

export type UserMessageMenuEntry = 'undo-send' | 'copy' | 'select-text'

export const USER_MESSAGE_MENU_LABELS: Record<UserMessageMenuEntry, string> = {
  'undo-send': 'Undo send',
  copy: 'Copy message',
  'select-text': 'Select text'
}

/** The title of the sheet "Select text" opens. */
export const SELECT_TEXT_SHEET_TITLE = 'Select text'

/**
 * The entries a message offers, in the app's order. A message with no words
 * offers no Copy and no Select (there is nothing to copy or select); one that
 * is not waiting offers no Undo. A message that offers nothing gets no menu
 * at all, so a hold on it does nothing, as a hold on an image-only prompt
 * always did.
 */
export function userMessageMenuEntries(input: {
  hasText: boolean
  waiting: boolean
}): UserMessageMenuEntry[] {
  const entries: UserMessageMenuEntry[] = []
  if (input.waiting) {
    entries.push('undo-send')
  }
  if (input.hasText) {
    entries.push('copy', 'select-text')
  }
  return entries
}
