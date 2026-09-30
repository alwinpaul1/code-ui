import { inlineBreaksAsLines, inlineBreaksAsNewlines, MARKDOWN_INLINE_BREAK, pipeTableRows } from '../markdown-inline-breaks'
import type { MarkdownBlock } from './markdown-blocks'
import type { LexedCommentBody } from './markdown-fences'
import { HR, ORDERED, UNORDERED } from './markdown-list-blocks'

/**
 * A `<br>` in a PR comment body, for parseMarkdownBlocks.
 *
 * The lexer stands every `<br>` outside code aside as MARKDOWN_INLINE_BREAK
 * (markdown-fences.ts). On a line the block reader takes as one block's line
 * (a table row, a list item's own line or one of its wrapped lines, a quote
 * line, a heading) it stays until the block is read, then is a line break
 * inside the cell, the item, the quote or the heading. Only a table row kept
 * it before, so review bots' '- item<br>detail' and '1. **File**<br>`x.ts`'
 * drew the words after the break as a paragraph at the margin and the rest as
 * a second list counting from 2, '> a<br>b' a quote and a paragraph, and
 * '## T<br>sub' a heading and a paragraph (review, 2026-09-30). GitHub reads
 * a `<br>` as a break inside the block, and so does the chat.
 *
 * On any other line, a paragraph's, it is a newline before the lines are
 * read, as it always was, so a paragraph's break reads as it did.
 */

// Its closing run of '#' comes off in markdownHeadingText.
export const HEADING = /^(#{1,6})\s+(.*)$/
export const QUOTE = /^>\s?(.*)$/

/** Whether parseList reads `line` as an item's own line or one of its
 *  wrapped lines, `inItem` saying the line before was one. A wrapped line is
 *  indented, not blank and no marker; a fence ends the item, and after it
 *  only a marker goes on with the list. */
function readsAsItemLine(line: string, inItem: boolean, body: LexedCommentBody): boolean {
  if (body.fenceOn(line)) {
    return false
  }
  if (ORDERED.test(line) || UNORDERED.test(line)) {
    // A rule ends the list, though `* * *` fits a marker (markdown-list-blocks.ts).
    return !HR.test(line)
  }
  return inItem && line.trim() !== '' && /^\s/.test(line)
}

/** `text` with each MARKDOWN_INLINE_BREAK on a paragraph's line as the
 *  newline it was before, and every other one kept for its block. */
export function expandParagraphBreaks(text: string, body: LexedCommentBody): string {
  if (!text.includes(MARKDOWN_INLINE_BREAK)) {
    return text
  }
  const lines = text.split('\n')
  const rows = pipeTableRows(lines)
  let inItem = false
  return lines
    .map((line, index) => {
      inItem = readsAsItemLine(line, inItem, body)
      const kept = rows[index] || inItem || HEADING.test(line) || QUOTE.test(line)
      return kept ? line : line.replaceAll(MARKDOWN_INLINE_BREAK, '\n')
    })
    .join('\n')
}

/** A block with every MARKDOWN_INLINE_BREAK it kept as a line break: in its
 *  cells, its items, its words, and wherever else such a line was read, so
 *  none is drawn as a stand-in. */
export function withLineBreaks(block: MarkdownBlock): MarkdownBlock {
  const breaks = inlineBreaksAsNewlines
  switch (block.kind) {
    case 'heading':
    case 'quote':
      return { ...block, text: inlineBreaksAsLines(block.text) }
    case 'list':
      return { ...block, items: block.items.map(inlineBreaksAsLines) }
    case 'paragraph':
      return { ...block, text: breaks(block.text) }
    case 'table':
      return { ...block, headers: block.headers.map(breaks), rows: block.rows.map((row) => row.map(breaks)) }
    case 'details':
      return { ...block, summary: breaks(block.summary), body: block.body.map(withLineBreaks) }
    case 'code':
    case 'hr':
      return block
    default: {
      const unhandled: never = block
      return unhandled
    }
  }
}
