import { cutLineNote, displayColumns } from './mobile-code-indent'

/** Code text size and row height, before the phone's font scale. */
export const CODE_VIEW_FONT_SIZE = 13
export const CODE_VIEW_LINE_HEIGHT = 20
/** JetBrains Mono's advance width: 600 of its 1000 units per em, for every
 *  glyph (read from the bundled TTF's hmtx table). */
const JETBRAINS_MONO_ADVANCE_EM = 0.6
/** Space after the line numbers, before the fold toggles. */
const NUMBER_GAP = 6
/** Space after the line numbers in a file with nothing to fold: the gap the
 *  gutter always had, so plain text and logs keep it (review, 2026-09-27). */
const GUTTER_GAP = 14
/** The fold toggles' column (▾/▸), between the numbers and the code: two
 *  cells and a little, so the glyph sits clear of the code. */
const FOLD_COLUMN_CELLS = 2
const FOLD_COLUMN_PAD = 2
const PADDING_START = 6
/** Room past the longest line, so its last character is not against the edge. */
const PADDING_END = 24
/**
 * Past this many columns an unwrapped line is cut, and a file holding one
 * opens wrapped. One minified line of a megabyte would otherwise make the
 * view eight million points wide, far past what a text layout can draw.
 */
export const CODE_VIEW_MAX_NO_WRAP_COLUMNS = 2_000

export type CodeViewMetrics = {
  fontSize: number
  lineHeight: number
  /** One grid column, in points. */
  cellWidth: number
  /** One row, in points: the line height at the phone's font scale. */
  rowHeight: number
  gutterDigits: number
  /** The line numbers and the gap after them. */
  numberWidth: number
  /** The fold toggles' column. */
  foldWidth: number
  /** Everything left of the code: numbers and fold toggles. */
  gutterWidth: number
  /** Everything an unwrapped row needs, so no row has to wrap. */
  contentWidth: number
}

/** The grid, from the file and the phone's font scale. React Native scales
 *  the font size and line height by `fontScale`, so the columns and rows the
 *  guides and list positions are computed on have to scale with them. */
export function codeViewMetrics({
  lineCount,
  maxColumns,
  fontScale,
  foldable = false
}: {
  lineCount: number
  maxColumns: number
  fontScale: number
  /** The file has blocks to fold: the gutter makes room for their toggles. */
  foldable?: boolean
}): CodeViewMetrics {
  const scale = fontScale > 0 ? fontScale : 1
  const cellWidth = CODE_VIEW_FONT_SIZE * JETBRAINS_MONO_ADVANCE_EM * scale
  const gutterDigits = Math.max(2, String(Math.max(lineCount, 1)).length)
  const numberWidth = Math.ceil(gutterDigits * cellWidth + (foldable ? NUMBER_GAP : GUTTER_GAP))
  const foldWidth = foldable ? Math.ceil(FOLD_COLUMN_CELLS * cellWidth + FOLD_COLUMN_PAD) : 0
  const gutterWidth = numberWidth + foldWidth
  // A line past the limit is cut and ends in a note; the row is as wide as
  // the longest note the file can need (no more characters are hidden than
  // it has columns), or the count would be cut off with the line.
  const columns =
    (maxColumns > CODE_VIEW_MAX_NO_WRAP_COLUMNS
      ? CODE_VIEW_MAX_NO_WRAP_COLUMNS + displayColumns(cutLineNote(maxColumns), 1)
      : maxColumns) + 2
  return {
    fontSize: CODE_VIEW_FONT_SIZE,
    lineHeight: CODE_VIEW_LINE_HEIGHT,
    cellWidth,
    rowHeight: CODE_VIEW_LINE_HEIGHT * scale,
    gutterDigits,
    numberWidth,
    foldWidth,
    gutterWidth,
    contentWidth: Math.ceil(PADDING_START + gutterWidth + columns * cellWidth + PADDING_END)
  }
}

export const CODE_VIEW_PADDING_START = PADDING_START

/**
 * How far a fold toggle's touch reaches past its column: into the gap
 * after the line number, and no further. Not up or down: FlatList cells are
 * siblings tried from the last, and a hitSlop grows its row's overflow, so
 * a toggle reaching 14 points up took the line above's taps, its number's
 * long-press and its first characters, and a 15-point reach to the left
 * took its own number's ones digit (review, 2026-09-27: the 48-point target
 * of 646eebfb). A row cannot hold a target taller than itself without
 * stealing from its neighbour. Not right either: the code is tried first
 * and owns all of it.
 */
export const CODE_VIEW_FOLD_HIT_SLOP = { top: 0, bottom: 0, left: NUMBER_GAP, right: 0 } as const

/** Wrapping is off, as on the desktop, unless a line is too long to draw
 *  unwrapped. The reader can turn it on or off either way. */
export function defaultCodeViewWrap(doc: { maxColumns: number }): boolean {
  return doc.maxColumns > CODE_VIEW_MAX_NO_WRAP_COLUMNS
}

type ItemLayout = { length: number; offset: number; index: number }

export type CodeViewListLayout = {
  /** Whether the list sits in a sideways scroller. */
  horizontal: boolean
  listStyle: { minWidth?: number }
  rowStyle: { height?: number }
  numberOfLines: 1 | undefined
  getItemLayout: ((data: unknown, index: number) => ItemLayout) | undefined
}

/**
 * How the list is laid out. Unwrapped, every row is one line of one height,
 * in a list as wide as the longest line inside a sideways scroller: the file
 * scrolls as a whole, so every line keeps its indentation under the one above
 * (reported 2026-09-26: wrapped continuation rows hid it). A fixed row height
 * also lets the list place any row without measuring, which keeps a long file
 * smooth and lets it open at a line. Wrapped, rows size themselves.
 */
export function codeViewListLayout(wrap: boolean, metrics: CodeViewMetrics): CodeViewListLayout {
  if (wrap) {
    return {
      horizontal: false,
      listStyle: {},
      rowStyle: {},
      numberOfLines: undefined,
      getItemLayout: undefined
    }
  }
  const length = metrics.rowHeight
  return {
    horizontal: true,
    listStyle: { minWidth: metrics.contentWidth },
    rowStyle: { height: length },
    numberOfLines: 1,
    getItemLayout: (_data, index) => ({ length, offset: length * index, index })
  }
}
