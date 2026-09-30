/**
 * A table row's cells, on both halves of the round trip.
 *
 * The pipe is the row's only separator and also an ordinary character a cell may contain. The
 * phone splits a row the way the desktop's editor does (tiptap's markdown, which is marked): a pipe
 * belongs to its cell when an ODD run of backslashes sits right before it, so `\\|` is a
 * backslash and then a separator. Reading a cell takes one backslash off each such pipe; nothing
 * else about a backslash is the table's — the cell is inline markdown, and `\s`, `C:\\path` or
 * `\"` mean what they mean there.
 *
 * The writer makes every pipe a cell holds end an odd run: an even run (none included) gains one
 * backslash, an odd one is already escaped. Every cell the reader produces has even runs, so any
 * file comes back byte for byte apart from the writer's own spacing (`| a | b |`), which also keeps
 * a cell's trailing backslash off the separator after it.
 *
 * Code UI, 2026-09-23. Upstream's #22054 doubled every backslash on write, so a save rewrote a lone
 * `\s+` in a table to `\\s+`; a first local fix read `\\|` as content (cmark-gfm's reading),
 * which merged a no-space header's columns where the desktop sees two, and the save then deleted
 * the second column. Both reviews are pinned in rich-markdown-table-backslash-round-trip.test.ts.
 */

/** Whether `value[index]` is a pipe that separates cells: an even run of backslashes before it. */
function isSeparatorPipe(value: string, index: number): boolean {
  if (value[index] !== '|') {
    return false
  }
  let backslashes = 0
  for (let before = index - 1; before >= 0 && value[before] === '\\'; before -= 1) {
    backslashes += 1
  }
  return backslashes % 2 === 0
}

/** Splits on the separator pipes, leaving every escaped one in its cell. */
function splitOnSeparatorPipes(value: string): string[] {
  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < value.length; index += 1) {
    if (isSeparatorPipe(value, index)) {
      cells.push(cell)
      cell = ''
      continue
    }
    cell += value[index]!
  }
  cells.push(cell)
  return cells
}

/** A table row's cells, with the optional leading and trailing pipes taken off. */
export function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  const body = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const cells = splitOnSeparatorPipes(body)
  if (body.length > 0 && isSeparatorPipe(body, body.length - 1)) {
    cells.pop()
  }
  return cells.map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

/** A cell's own pipes, hidden from the row syntax that would split on them. Only the pipes. */
export function escapeTableCell(cell: string): string {
  return cell.replace(/(\\*)\|/g, (match, run: string) =>
    run.length % 2 === 0 ? `${run}\\|` : match
  )
}

/**
 * The dashed row under a header, which is what makes the line above it a table rather than text.
 *
 * GFM's rule, as the desktop's marked and the chat read it: one dash or more a cell, with a colon
 * at either end for alignment, and as many cells as the header (`width`). A line of dashes with no
 * pipe and no colon is a setext underline or a rule, never a one-column separator. The editor
 * asked for three dashes a cell until 2026-09-30, so `| - | - |` and `|:-:|--:|` made their table
 * a paragraph whose reflow joined its rows on the next save.
 */
export function isTableSeparator(line: string, width: number): boolean {
  if (!/[|:]/.test(line)) {
    return false
  }
  const cells = splitTableRow(line)
  return cells.length === width && cells.every((cell) => /^:?-+:?$/.test(cell))
}

/** Whether a line and the one under it open a table: a header with a pipe, and its separator. */
export function opensTable(line: string, next: string | undefined): boolean {
  return (
    line.includes('|') && next !== undefined && isTableSeparator(next, splitTableRow(line).length)
  )
}

/** The attribute that keeps a table's separator row as the source wrote it: alignment, dashes. */
export const TABLE_SEPARATOR_ATTRIBUTE = 'data-md-separator'
/** The attribute that says the source wrote the table's rows without their outer pipes. */
export const TABLE_BARE_ATTRIBUTE = 'data-md-bare'

/** Whether a row, trimmed, leaves its outer pipes off: `a | b` rather than `| a | b |`. */
function isBareRow(line: string): boolean {
  const trimmed = line.trim()
  return !trimmed.startsWith('|') && !isSeparatorPipe(trimmed, trimmed.length - 1)
}

function rowMarkdown(cells: readonly string[], bare: boolean): string {
  return bare ? cells.join(' | ') : `| ${cells.join(' | ')} |`
}

function dashesFor(cells: readonly string[], bare: boolean): string {
  return rowMarkdown(
    cells.map(() => '---'),
    bare
  )
}

/**
 * How a table's header and separator were written, as attributes for its `<table>`, so a save
 * writes them back that way (the precedent is AUTOLINK_ATTRIBUTE in markdown-inline-render.ts).
 * Nothing for the shape the writer produces anyway, so an ordinary table's markup is unchanged.
 * The separator holds only dashes, colons, pipes and spaces, so it needs no escaping.
 */
export function tableSourceAttributes(headerLine: string, separatorLine: string): string {
  const bare = isBareRow(headerLine)
  const separator = separatorLine.trim()
  const written = dashesFor(splitTableRow(headerLine), bare)
  return (
    (separator === written ? '' : ` ${TABLE_SEPARATOR_ATTRIBUTE}="${separator}"`) +
    (bare ? ` ${TABLE_BARE_ATTRIBUTE}="true"` : '')
  )
}

/**
 * A table as markdown, from its cells (already escaped) and what its source remembered.
 *
 * The remembered separator is written only while it still has the header's width: a table that
 * lost a column under it would not be a table to GFM. Rows go without outer pipes only when every
 * row has two cells or more and none starts or ends empty, since `| 2` reads as a leading pipe and
 * one cell, and a row with no pipe at all ends the table.
 */
export function tableMarkdown(
  headers: readonly string[],
  bodyRows: readonly (readonly string[])[],
  source: { separator: string | null; bare: boolean }
): string {
  const rows = [headers, ...bodyRows]
  const bare =
    source.bare &&
    rows.every((row) => row.length > 1 && row[0] !== '' && row[row.length - 1] !== '')
  const separator =
    source.separator !== null && isTableSeparator(source.separator, headers.length)
      ? source.separator
      : dashesFor(headers, bare)
  return [rowMarkdown(headers, bare), separator, ...bodyRows.map((row) => rowMarkdown(row, bare))]
    .join('\n')
}
