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
export const TABLE_CELL_MIN_WIDTH = 72
export const TABLE_CELL_MAX_WIDTH = 260
/** Average advance of the UI face at 1 px font size; Instrument Sans is a
 *  little narrower than 0.55 em, so this errs toward a slightly wide cell,
 *  which reads better than a cramped one. */
const AVERAGE_CHAR_EM = 0.55

export function tableColumnCount(headers: readonly string[], rows: readonly (readonly string[])[]): number {
  return Math.max(headers.length, ...rows.map((row) => row.length), 1)
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
    let longest = 0
    for (const row of [args.headers, ...args.rows]) {
      // Inline markup markers (`, *, _) do not paint; do not pay for them.
      const text = (row[column] ?? '').replace(/[`*_]/g, '')
      longest = Math.max(longest, text.length)
    }
    const estimate = Math.ceil(longest * args.fontSize * AVERAGE_CHAR_EM) + args.horizontalPadding * 2
    widths.push(Math.max(min, Math.min(max, estimate)))
  }
  return widths
}
