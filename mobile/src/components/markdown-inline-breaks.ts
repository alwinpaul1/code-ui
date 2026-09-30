/**
 * A `<br>` in a table row, for the chat (the HTML pass in
 * mobile-markdown-preview-html.ts and the parser in mobile-markdown-parser.ts)
 * and for a PR comment (the lexer in pr-sidebar/markdown-fences.ts and
 * parseMarkdownBlocks), and in a chat heading, list item or quote.
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
 * way and is a line break inside the heading.
 *
 * So does one on a chat list item's lines and a quote's (markBlockLineBreaks).
 * There it was a Markdown hard break, two spaces and a newline, and two in a
 * row left a whitespace-only line, which ended the list: '1. a<br><br>b\n2. c'
 * drew the list [a] and the paragraph "b 2. c", and '- a<br>- b' two items
 * (review, 2026-09-30). Anywhere else in a chat reply a `<br>` is still a
 * hard break (normalizeInlineHtml).
 *
 * A PR comment keeps it on a list item's lines and a quote's too, where a
 * newline cut the item or the quote in two; which lines keep it is
 * pr-sidebar/markdown-block-breaks.ts. Both readers draw a kept one as
 * inlineBreaksAsLines does.
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

/** A list item's marker line, as marked reads one at any depth. */
const LIST_ITEM_LINE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
/** A thematic break, which `* * *` is though it fits a marker. */
const RULE_LINE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE_LINE = /^ {0,3}>/

/**
 * `text` with each `<br>` on a line marked reads as part of one block as
 * MARKDOWN_INLINE_BREAK: a table row, a heading, a list item's marker line
 * and a quote's `>` line, and each line after one of those two that is not
 * blank and follows it directly (its wrapped or lazy line) or is indented
 * (the item's next paragraph). After a blank line, a heading or a rule, which
 * no paragraph runs on from, a line that is not indented ends the item or
 * the quote. Where this still takes a line for an item's that marked reads
 * as a paragraph's (one after a fence under an item), its `<br>` is a line
 * break, as a hard break draws it, and two draw a gap inside the paragraph
 * instead of ending it; the parser turns one it finds in a code block or an
 * image the same way.
 */
export function markBlockLineBreaks(text: string): string {
  if (!/<br/i.test(text)) {
    return text
  }
  const lines = text.split('\n')
  const rows = text.includes('|') ? pipeTableRows(lines) : []
  let inBlock = false
  // Whether the line before ended any paragraph it was in.
  let ended = false
  return lines
    .map((line, index) => {
      if (line.trim() === '') {
        ended = true
        return line
      }
      if ((LIST_ITEM_LINE.test(line) && !RULE_LINE.test(line)) || QUOTE_LINE.test(line)) {
        inBlock = true
      } else {
        inBlock = inBlock && (!ended || /^[ \t]/.test(line))
      }
      ended = HEADING_LINE.test(line) || RULE_LINE.test(line)
      return rows[index] || inBlock || HEADING_LINE.test(line) ? keepBreaksInLine(line) : line
    })
    .join('\n')
}

/** A cell's, or any text's, MARKDOWN_INLINE_BREAK as a line break. */
export function inlineBreaksAsNewlines(text: string): string {
  return text.includes(MARKDOWN_INLINE_BREAK) ? text.replaceAll(MARKDOWN_INLINE_BREAK, '\n') : text
}

/**
 * An item's, a quote's or a heading's text with each MARKDOWN_INLINE_BREAK a
 * line break, drawn as GitHub draws one: the spaces and newline beside a
 * break are no line of their own, so '- a<br>\n  b' is two lines and not
 * three, and a break at either end draws no blank line, as one at either end
 * of a paragraph never did. Two in a row keep a blank line between them, the
 * gap '- a<br><br>b' asks for.
 */
export function inlineBreaksAsLines(text: string): string {
  if (!text.includes(MARKDOWN_INLINE_BREAK)) {
    return text
  }
  return text
    .split(MARKDOWN_INLINE_BREAK)
    .map((part) => part.trim())
    .join('\n')
    .trim()
}
