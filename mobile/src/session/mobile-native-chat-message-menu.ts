// What a hold on a message offers, after the Claude app's Code-session timeline
// (com.anthropic.claude 1.261009.20). A hold on a prose row, Claude's or the
// user's, holds that message and draws a menu card anchored to it (fmg.java),
// with these actions, sorted by t030.t (t030.java:7234-7248):
//
//   Reply        0   a shared session's reply (koy/joy), never in Code UI
//   Edit         1   the user's own editable message (hoy)
//   Copy         2   goy(text)
//   Select text  3   moy(text): a sheet holding the text, selectable
//
// The list is built in one place (dexdump of classes3.dex, the method that
// makes each TimelineDisplayRow): Copy and Select text are added together, both
// with the row's `Prose.text` (npy.c, the message text as it arrived, Markdown
// source and all), and only when that text is not blank. Code UI differs on
// purpose, by the user's choice (2026-10-15): it gives the words as drawn,
// without Markdown marks, and a message that is only markup offers nothing. A row that is not
// prose (a tool call, a thought) gets no menu, and a row with nothing to offer
// gets no hold at all (g7q.java:595).
//
// Labels (res/values/strings.xml): Copy is `generic_copy` "Copy" (rgs.java:95),
// not the chat app's "Copy message"; Select text is
// `chat_message_bottom_sheet_menu_select`.
//
// Code UI offers Undo send in Edit's place, for a message still waiting behind
// a running turn: it is the one change to a sent message Claude Code can make
// (the same as the queue's Cancel). Reply and Edit have no Claude Code action.

export type ChatMessageMenuEntry = 'undo-send' | 'copy' | 'select-text'

export const CHAT_MESSAGE_MENU_LABELS: Record<ChatMessageMenuEntry, string> = {
  'undo-send': 'Undo send',
  copy: 'Copy',
  'select-text': 'Select text'
}

/** The title of the sheet "Select text" opens (the same string as the menu row). */
export const SELECT_TEXT_SHEET_TITLE = 'Select text'

/**
 * The entries a message offers, in the app's order. A message with no words
 * offers no Copy and no Select; one that is not waiting offers no Undo. A
 * message that offers nothing gets no menu, so a hold on it does nothing.
 */
export function chatMessageMenuEntries(input: { hasText: boolean; waiting: boolean }): ChatMessageMenuEntry[] {
  const entries: ChatMessageMenuEntry[] = []
  if (input.waiting) {
    entries.push('undo-send')
  }
  if (input.hasText) {
    entries.push('copy', 'select-text')
  }
  return entries
}

/** The held message's box in window coordinates (measureInWindow). */
export type ChatMessageMenuAnchor = { x: number; y: number; width: number; height: number }

/** The card's geometry. Radius 12 dp (`bn7.f`, zlw.h) and 4 dp above and below
 *  the rows (fmg.java `a`). A row is 48 dp, Material's menu row (`hb20.b`). */
export const MESSAGE_MENU_RADIUS = 12
export const MESSAGE_MENU_PAD_Y = 4
export const MESSAGE_MENU_ROW_HEIGHT = 48
/** The card keeps 16 dp from the screen's safe edges (fmg.java `c`: insets + 16). */
export const MESSAGE_MENU_EDGE = 16
/** The air between the held message and the card. */
export const MESSAGE_MENU_GAP = 8

export type ChatMessageMenuPlacement = {
  top: number
  /** Exactly one of these is set: the card hangs from the message's start
   *  (Claude's words) or its end (the user's). */
  left?: number
  right?: number
}

/**
 * Where the card goes. Horizontally it lines up with the message's start, or
 * its end for the user's own (fmg.java `e`: `alignEnd ? right - width : left`,
 * kept inside the edges). Vertically it hangs under the message, or sits over
 * it when there is no room under, and is kept on screen either way.
 */
export function chatMessageMenuPlacement(input: {
  anchor: ChatMessageMenuAnchor
  alignEnd: boolean
  rows: number
  window: { width: number; height: number }
  insets: { top: number; bottom: number; left: number; right: number }
}): ChatMessageMenuPlacement {
  const { anchor, alignEnd, rows, window, insets } = input
  const height = rows * MESSAGE_MENU_ROW_HEIGHT + 2 * MESSAGE_MENU_PAD_Y
  const minTop = insets.top + MESSAGE_MENU_EDGE
  const maxTop = window.height - insets.bottom - MESSAGE_MENU_EDGE - height
  const below = anchor.y + anchor.height + MESSAGE_MENU_GAP
  const above = anchor.y - MESSAGE_MENU_GAP - height
  const preferred = below <= maxTop ? below : above >= minTop ? above : maxTop
  const top = Math.max(minTop, Math.min(preferred, Math.max(minTop, maxTop)))
  if (alignEnd) {
    const fromRight = window.width - (anchor.x + anchor.width)
    return { top, right: Math.max(insets.right + MESSAGE_MENU_EDGE, fromRight) }
  }
  return { top, left: Math.max(insets.left + MESSAGE_MENU_EDGE, anchor.x) }
}
