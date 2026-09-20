/**
 * One width per column for a Markdown table, shared by the header and every
 * row. Before 2026-09-09 each cell sized itself to its own text, so column N
 * started at a different x on every row and the grid lines staggered
 * (Galaxy S23 screenshots of a "Job / What / Result" table).
 *
 * Widths are estimated from character counts against the cell font size,
 * which is deterministic and needs no measuring pass; a wrapped cell simply
 * grows in height. Long columns are capped so a table stays scrollable rather
 * than one column swallowing the screen; short ones keep a readable minimum.
 */
import { inlineCodeChipMaxChars } from './mobile-markdown-code-chip-split'

export const TABLE_CELL_MIN_WIDTH = 72
export const TABLE_CELL_MAX_WIDTH = 260
/** Average advance of the UI face at 1 px font size; Instrument Sans is a
 *  little narrower than 0.55 em, so this errs toward a slightly wide cell,
 *  which reads better than a cramped one. */
const AVERAGE_CHAR_EM = 0.55

export function tableColumnCount(headers: readonly string[], rows: readonly (readonly string[])[]): number {
  return Math.max(headers.length, ...rows.map((row) => row.length), 1)
}

/** How many characters of a code span fit one pill in a cell of this width:
 *  the paragraph rule (`inlineCodeChipMaxChars`) applied to the cell's inner
 *  width. Why: cells used the 34-character fallback, wider than a 260 dp
 *  column can hold, and a pill wider than its cell wraps inside the pill and
 *  paints over the line below (phone, 2026-09-21). */
export function tableCellChipMaxChars(columnWidth: number, horizontalPadding: number, chipFontSize: number): number {
  return inlineCodeChipMaxChars(columnWidth - horizontalPadding * 2, chipFontSize)
}

/** A code span paints wider than prose: the mono face's 0.6 em advance, plus
 *  the pill's insets around it. Estimating it at the prose advance left a
 *  cell one pill wide short by a quarter (`git.generateCommitMessage`). */
const MONO_CHAR_EM = 0.6
const CHIP_INSETS = 18
const CODE_SPAN = /`([^`]+)`/g

function cellPaintedWidth(cell: string, fontSize: number): number {
  let width = 0
  let prose = cell
  for (const match of cell.matchAll(CODE_SPAN)) {
    width += Math.ceil((match[1] ?? '').length * fontSize * MONO_CHAR_EM) + CHIP_INSETS
    prose = prose.replace(match[0], '')
  }
  // Inline markup markers (*, _) do not paint; do not pay for them.
  return width + Math.ceil(prose.replace(/[*_]/g, '').length * fontSize * AVERAGE_CHAR_EM)
}

export function computeTableColumnWidths(args: {
  headers: readonly string[]
  rows: readonly (readonly string[])[]
  columnCount: number
  fontSize: number
  horizontalPadding: number
  minWidth?: number
  maxWidth?: number
}): number[] {
  const min = args.minWidth ?? TABLE_CELL_MIN_WIDTH
  const max = args.maxWidth ?? TABLE_CELL_MAX_WIDTH
  const widths: number[] = []
  for (let column = 0; column < args.columnCount; column += 1) {
    let widest = 0
    for (const row of [args.headers, ...args.rows]) {
      widest = Math.max(widest, cellPaintedWidth(row[column] ?? '', args.fontSize))
    }
    const estimate = widest + args.horizontalPadding * 2
    widths.push(Math.max(min, Math.min(max, estimate)))
  }
  return widths
}
