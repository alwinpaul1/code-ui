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

/** The dashed row under a header, which is what makes the line above it a table rather than text. */
export function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}
