// Which pipes in a GFM table row are cell boundaries. A pipe with an odd run
// of backslashes before it is escaped: GFM keeps it in the cell, inside a
// code span too (spec example 200), and marked, which reads the chat's tables,
// counts the run the same way. An even run is escaped backslashes and a real
// boundary. The shade split on every pipe, so `| a \| b | ok |` read as three
// cells and lost the pipe (review, 2026-09-30). A pipe inside a code span with
// no backslash is still a boundary, as in GFM and in the chat.

/** Whether a backslash escapes the character at `index`. */
function escapedAt(text: string, index: number): boolean {
  let run = 0
  while (index - run > 0 && text[index - run - 1] === '\\') {
    run += 1
  }
  return run % 2 === 1
}

/** The text between its unescaped pipes; each cell keeps any `\|` it holds. */
export function splitOnPipes(text: string): string[] {
  const cells: string[] = []
  let start = 0
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '|' && !escapedAt(text, at)) {
      cells.push(text.slice(start, at))
      start = at + 1
    }
  }
  cells.push(text.slice(start))
  return cells
}

/** Whether the line's last pipe, as trimmed, is a boundary and not `\|`. */
export function endsWithBoundaryPipe(line: string): boolean {
  const trimmed = line.trimEnd()
  return trimmed.endsWith('|') && !escapedAt(trimmed, trimmed.length - 1)
}

/** The row with each escaped pipe, backslash and all, swapped for `stand`, a
 *  character the text does not hold: nothing downstream then splits on it,
 *  and the caller puts `|` back once the cells are apart. */
export function maskEscapedPipes(row: string, stand: string): string {
  let out = ''
  let copied = 0
  for (let at = 0; at < row.length; at += 1) {
    if (row[at] === '|' && escapedAt(row, at)) {
      out += row.slice(copied, at - 1) + stand
      copied = at + 1
    }
  }
  return copied === 0 ? row : out + row.slice(copied)
}
