/**
 * A table row's cells, on both halves of the round trip.
 *
 * The pipe is the row's only separator and also an ordinary character a cell may contain. GFM
 * (cmark-gfm, which GitHub and the desktop render with) settles it one way: a pipe with a backslash
 * right before it belongs to the cell, whatever precedes that backslash, and reading the cell takes
 * exactly that one backslash off. Nothing else about a backslash is the table's business — the cell
 * is inline markdown, and `\s`, `C:\\path` or `\"` mean what they mean there.
 *
 * So the writer adds one backslash before each pipe and nothing else, and the reader removes one
 * before each pipe and nothing else: a cell of any content comes back byte for byte, because every
 * separator the writer emits has a space before it (`| a | b |`). Code UI, 2026-09-23: upstream's
 * #22054 doubled every backslash on write and undid only `\\` and `\|` on read, so saving any edit
 * rewrote a lone `\s+` in a table to `\\s+`, which renders differently inside a code span.
 */

/** Whether `value[index]` is a pipe that separates cells: one no backslash sits right before. */
function isSeparatorPipe(value: string, index: number): boolean {
  return value[index] === '|' && (index === 0 || value[index - 1] !== '\\')
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
  return cell.replace(/\|/g, '\\|')
}

/** The dashed row under a header, which is what makes the line above it a table rather than text. */
export function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}
