/**
 * A `<br>` in a table row, for the chat (the HTML pass in
 * mobile-markdown-preview-html.ts and the parser in mobile-markdown-parser.ts)
 * and for a PR comment (the lexer in pr-sidebar/markdown-fences.ts and
 * parseMarkdownBlocks).
 *
 * Bots and agents write a multi-line cell as `| a.ts | one<br>two |`. Both
 * readers turned the `<br>` into a newline before the table was read, so the
 * row was cut in two: the cell lost "two", which became a bogus row with the
 * wrong number of cells, and the reply's Copy was wrong too (review,
 * 2026-09-30). On a table row the `<br>` now stands aside as
 * MARKDOWN_INLINE_BREAK until the cells are split, and becomes a line break
 * inside its cell.
 */

/** A `<br>` a table row keeps until its cells are split. A private-use
 *  character around a name, as the HTML pass's other stand-ins are. */
export const MARKDOWN_INLINE_BREAK = '\uE000ORCA_MD_BR\uE000'

/** Every spelling of the tag: `<br>`, `<br/>`, `<br />`, `<BR>`. */
const BREAK_TAG = /<br\s*\/?>/gi
/** A line from its first `<br>` on. */
const FROM_BREAK_TAG = /<br\s*\/?>[\s\S]*$/i

/** A delimiter row: every cell dashes, a colon at either end allowed, as
 *  isTableDelimiter in pr-sidebar/markdown-blocks.ts reads one. */
function isDelimiterRow(line: string): boolean {
  let row = line.trim()
  if (row.startsWith('|')) {
    row = row.slice(1)
  }
  if (row.endsWith('|') && !row.endsWith('\\|')) {
    row = row.slice(0, -1)
  }
  return row.split('|').every((cell) => /^:?-+:?$/.test(cell.trim()))
}

/** A line up to its first `<br>`, where the line ended before. */
function beforeBreak(line: string): string {
  return line.split(MARKDOWN_INLINE_BREAK)[0]!.replace(FROM_BREAK_TAG, '')
}

/**
 * Which of `lines` are the rows of a pipe table, as the PR reader finds one
 * (parseLines in pr-sidebar/markdown-blocks.ts): a line holding a pipe with a
 * delimiter row under it, the delimiter row, and every line after them that
 * holds a pipe and is not blank. A line is read up to its first `<br>` when
 * it is tried as a delimiter row, where the `<br>` ended the line before.
 */
export function pipeTableRows(lines: readonly string[]): boolean[] {
  const rows = Array.from({ length: lines.length }, () => false)
  let inTable = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (inTable && (!line.includes('|') || line.trim() === '')) {
      inTable = false
    }
    const next = lines[index + 1]
    if (!inTable && line.includes('|') && next !== undefined && isDelimiterRow(beforeBreak(next))) {
      inTable = true
    }
    rows[index] = inTable
  }
  return rows
}

/** `text` with each `<br>` on a table row as MARKDOWN_INLINE_BREAK. */
export function markTableRowBreaks(text: string): string {
  if (!text.includes('|') || !/<br/i.test(text)) {
    return text
  }
  const lines = text.split('\n')
  const rows = pipeTableRows(lines)
  return lines.map((line, index) => (rows[index] ? line.replace(BREAK_TAG, MARKDOWN_INLINE_BREAK) : line)).join('\n')
}

/** `text` with each MARKDOWN_INLINE_BREAK off a table row as the line break
 *  it was before, so only a table row keeps one. */
export function expandBreaksOffTableRows(text: string): string {
  if (!text.includes(MARKDOWN_INLINE_BREAK)) {
    return text
  }
  const lines = text.split('\n')
  const rows = pipeTableRows(lines)
  return lines.map((line, index) => (rows[index] ? line : line.replaceAll(MARKDOWN_INLINE_BREAK, '\n'))).join('\n')
}

/** A cell's, or any text's, MARKDOWN_INLINE_BREAK as a line break. */
export function inlineBreaksAsNewlines(text: string): string {
  return text.includes(MARKDOWN_INLINE_BREAK) ? text.replaceAll(MARKDOWN_INLINE_BREAK, '\n') : text
}
