// What a hold on a message offers, after the Claude app's Code-session timeline
// (com.anthropic.claude 1.261009.20; re-read in 1.261013.20). In Code UI only
// the user's own prompt is held this way: a hold on Claude's words starts
// Android's selection in place, because the app draws each text block of a
// message in its SelectionContainer (1.261013.20 gy30.j, t8i.o), and the
// prompt's bubble (gy30.d) has none.
//
// A held prompt gets Material 3's dropdown menu (qs30.a -> oxb.a -> ccr.d),
// filled by gy30.e: Copy message, then Select text (left out by the app for
// some rows, `dj4` case 0: `!z2 ? el4.b : null`). Both act on the row's
// `Prose.text` (the Markdown source); Code UI differs on purpose, by the
// user's choice (2026-10-15): it gives the words as drawn, without Markdown
// marks, and a message that is only markup offers nothing. A row that is not
// prose (a tool call, a thought) gets no menu, and a row with nothing to offer
// gets no hold at all.
//
// Labels (res/values/strings.xml): gy30.e draws
// `chat_message_bottom_sheet_menu_copy` "Copy message" and
// `chat_message_bottom_sheet_menu_select` "Select text" (gy30.java:31042,
// 31057). The l1s list (Reply / Copy / Select text / Edit, with `generic_copy`
// "Copy") is the shared-session timeline's menu, not this one; the user's
// 2026-10-15 recording of the app shows "Copy message".
//
// Code UI offers Undo send first, for a message still waiting behind a running
// turn: it is the one change to a sent message Claude Code can make (the same
// as the queue's Cancel). Reply and Edit have no Claude Code action.

export type ChatMessageMenuEntry = 'undo-send' | 'copy' | 'select-text'

export const CHAT_MESSAGE_MENU_LABELS: Record<ChatMessageMenuEntry, string> = {
  'undo-send': 'Undo send',
  copy: 'Copy message',
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

/** Material 3's menu as the app styles it: 12 dp corners (`ro7.a.f`, gcx.h), 8 dp above and below
 *  the rows (DropdownMenuContent), a 48 dp row (`sdd` case 1: sizeIn(minWidth 112, minHeight 48,
 *  maxWidth 280)), each row's surface inset 4 dp from the card's sides (jw30.h) and its content
 *  12 dp from that surface; a 20 dp glyph (jw30.l) and 16 dp from it to the label. A 3 dp shadow,
 *  no tonal tint and no border (qs30.a passes no border; oxb.a's tonal elevation default is 0). */
export const MESSAGE_MENU_RADIUS = 12
export const MESSAGE_MENU_PAD_Y = 8
export const MESSAGE_MENU_ROW_HEIGHT = 48
export const MESSAGE_MENU_ROW_INSET = 4
export const MESSAGE_MENU_ROW_PAD_X = 12
export const MESSAGE_MENU_ROW_MIN_WIDTH = 112
export const MESSAGE_MENU_ROW_MAX_WIDTH = 280
export const MESSAGE_MENU_GLYPH = 20
export const MESSAGE_MENU_GLYPH_GAP = 16
export const MESSAGE_MENU_ELEVATION = 3
/** The narrowest the card can be: one row at its minimum plus the rows' insets. The placement
 *  uses it until the card has been measured. */
export const MESSAGE_MENU_MIN_WIDTH = MESSAGE_MENU_ROW_MIN_WIDTH + 2 * MESSAGE_MENU_ROW_INSET
/** DropdownMenuPositionProvider's vertical margin (wdd: `N0(48)`); the horizontal one is 0. */
export const MESSAGE_MENU_VERTICAL_MARGIN = 48

/** The card's height for `rows` rows. */
export function chatMessageMenuHeight(rows: number): number {
  return rows * MESSAGE_MENU_ROW_HEIGHT + 2 * MESSAGE_MENU_PAD_Y
}

/** The menu opens from 80 % scale and closes back to it (pql.a), on the standard motion scheme's
 *  springs (tdm): scale is FastSpatial, spring(dampingRatio 0.9, stiffness 1400); alpha is
 *  FastEffects, spring(1, 3800). Compose's spring has mass 1, so damping = 2 * ratio * sqrt(k). */
export const MESSAGE_MENU_CLOSED_SCALE = 0.8
export const MESSAGE_MENU_SCALE_SPRING = { stiffness: 1400, damping: 2 * 0.9 * Math.sqrt(1400), mass: 1 } as const
export const MESSAGE_MENU_ALPHA_SPRING = { stiffness: 3800, damping: 2 * Math.sqrt(3800), mass: 1 } as const

export type ChatMessageMenuPlacement = {
  top: number
  /** Exactly one of these is set: `left` when the card starts at a point, `right` when it ends at
   *  one, so a card whose width is still a guess keeps the edge that was chosen. */
  left?: number
  right?: number
  /** Where the card grows from, as fractions of its box (Material's calculateTransformOrigin). */
  transformOrigin: { x: number; y: number }
}

type Candidate = { at: number; end?: boolean }

/** One axis of DropdownMenuPositionProvider (wdd.a): the first candidate that keeps `margin` from
 *  both window edges, or else the last one, clamped inside them (or centred, when the card does
 *  not fit between the margins at all). */
function pick(candidates: readonly Candidate[], size: number, lo: number, hi: number, margin: number): Candidate {
  const last = candidates[candidates.length - 1]!
  const fits = candidates.find((candidate) => candidate.at >= lo + margin && candidate.at + size <= hi - margin)
  if (fits) {
    return fits
  }
  if (size >= hi - lo - 2 * margin) {
    return { at: lo + Math.round((hi - lo - size) / 2) }
  }
  return { ...last, at: Math.min(Math.max(last.at, lo + margin), hi - margin - size) }
}

/** Material's transform origin on one axis: the middle of where the anchor meets the card. */
function origin(cardStart: number, cardSize: number, anchorStart: number, anchorEnd: number): number {
  if (cardStart >= anchorEnd) {
    return 0
  }
  if (cardStart + cardSize <= anchorStart) {
    return 1
  }
  if (cardSize === 0) {
    return 0
  }
  const middle = (Math.max(anchorStart, cardStart) + Math.min(anchorEnd, cardStart + cardSize)) / 2
  return (middle - cardStart) / cardSize
}

/**
 * Where the card goes, as the app places it. Its anchor is not the bubble but a zero-size Box
 * aligned to the bubble's bottom-end corner (qs30.a, `dlg.D` for a prompt drawn at the end), so
 * the anchor is that corner. Material then tries, across, the card starting at the anchor, then
 * ending at it, then against the window's nearer side; down, the card's top on the anchor (under
 * the bubble, with no gap), its bottom on the anchor (over the bubble's last lines, not above the
 * bubble), centred on it, then against the window's nearer edge (ljl cases 11 and 12), keeping
 * 48 dp from the top and bottom and nothing from the sides.
 */
export function chatMessageMenuPlacement(input: {
  /** The held bubble's box; a view that could not be measured gives a point. */
  anchor: ChatMessageMenuAnchor
  /** The card's size: its height from its rows, its width once measured. */
  card: { width: number; height: number }
  window: { width: number; height: number }
  /** The system bars, and the keyboard at the bottom: Compose's popup window is the visible
   *  display frame. */
  insets: { top: number; bottom: number; left: number; right: number }
}): ChatMessageMenuPlacement {
  const { anchor, card, window, insets } = input
  const corner = { x: anchor.x + anchor.width, y: anchor.y + anchor.height }
  const left = insets.left
  const right = window.width - insets.right
  const top = insets.top
  const bottom = window.height - insets.bottom
  const x = pick(
    [
      { at: corner.x },
      { at: corner.x - card.width, end: true },
      corner.x < (left + right) / 2 ? { at: left } : { at: right - card.width, end: true }
    ],
    card.width,
    left,
    right,
    0
  )
  const y = pick(
    [
      { at: corner.y },
      { at: corner.y - card.height },
      { at: corner.y - card.height / 2 },
      { at: corner.y < (top + bottom) / 2 ? top : bottom - card.height }
    ],
    card.height,
    top,
    bottom,
    MESSAGE_MENU_VERTICAL_MARGIN
  ).at
  const transformOrigin = {
    x: origin(x.at, card.width, corner.x, corner.x),
    y: origin(y, card.height, corner.y, corner.y)
  }
  return x.end
    ? { top: y, right: window.width - (x.at + card.width), transformOrigin }
    : { top: y, left: x.at, transformOrigin }
}
