/**
 * A `<br>` in a table row, for the chat (the HTML pass in
 * mobile-markdown-preview-html.ts and the parser in mobile-markdown-parser.ts)
 * and for a PR comment (the lexer in pr-sidebar/markdown-fences.ts and
 * parseMarkdownBlocks), and in a chat heading.
 *
 * Bots and agents write a multi-line cell as `| a.ts | one<br>two |`. Both
 * readers turned the `<br>` into a newline before the table was read, so the
 * row was cut in two: the cell lost "two", which became a bogus row with the
 * wrong number of cells, and the reply's Copy was wrong too (review,
 * 2026-09-30). On a table row the `<br>` now stands aside as
 * MARKDOWN_INLINE_BREAK until the cells are split, and becomes a line break
 * inside its cell.
 *
 * A heading is one line too: the chat's `# Title<br>sub` drew "Title" as the
 * heading and "sub" as a paragraph under it. Its `<br>` stands aside the same
 * way and is a line break inside the heading. Anywhere else in a chat reply a
 * `<br>` is a Markdown hard break (normalizeInlineHtml).
 *
 * A PR comment keeps it on a list item's lines and a quote's too, where a
 * newline cut the item or the quote in two; which lines keep it is
 * pr-sidebar/markdown-block-breaks.ts.
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

/** An ATX heading line, as marked reads one. */
const HEADING_LINE = /^ {0,3}#{1,6}(?:[ \t]|$)/

/** `text` with each `<br>` as MARKDOWN_INLINE_BREAK, for a block that is
 *  one line (a heading written as `<h2>…</h2>`). */
export function keepBreaksInLine(text: string): string {
  return text.replace(BREAK_TAG, MARKDOWN_INLINE_BREAK)
}

/** `text` with each `<br>` on a table row or a heading line as
 *  MARKDOWN_INLINE_BREAK. */
export function markOneLineBlockBreaks(text: string): string {
  if (!/<br/i.test(text)) {
    return text
  }
  const lines = text.split('\n')
  const rows = text.includes('|') ? pipeTableRows(lines) : []
  return lines
    .map((line, index) => (rows[index] || HEADING_LINE.test(line) ? keepBreaksInLine(line) : line))
    .join('\n')
}

/** A cell's, or any text's, MARKDOWN_INLINE_BREAK as a line break. */
export function inlineBreaksAsNewlines(text: string): string {
  return text.includes(MARKDOWN_INLINE_BREAK) ? text.replaceAll(MARKDOWN_INLINE_BREAK, '\n') : text
}
