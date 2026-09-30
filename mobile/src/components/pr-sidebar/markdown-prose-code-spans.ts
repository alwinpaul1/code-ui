import { markdownCodeSpans } from '../markdown-code-spans'
import { pipeTableRows } from '../markdown-inline-breaks'
import { HEADING, QUOTE } from './markdown-block-breaks'
import { HR, ORDERED, UNORDERED } from './markdown-list-blocks'

/**
 * The code spans of a PR comment body's prose, for the <details> and
 * <blockquote> split (markdown-html-blocks.ts), which reads no tag inside
 * one. It read every tag, so 'Use `<details>` to open and `</details>` to
 * close it.' drew as the paragraph 'Use `', a collapsible holding
 * '` to open and `', and the paragraph '` to close it.' (review, 2026-09-30).
 * The inline pass draws the spans as code, and GitHub the sentence as one
 * paragraph.
 *
 * Spans are found by the rule the inline pass uses, escapes and all
 * (markdown-code-spans.ts), over each run of lines the line reader
 * (parseLines in markdown-blocks.ts) hands the inline pass as one block's
 * text, so a span runs over a line break but never out of its block: a
 * paragraph's lines, a quote's `>` lines, or one list item's own line and
 * its indented wrapped lines. A blank line and a fence's placeholder line end
 * a run; a heading, a rule and a table row are a run of their own; a list
 * marker starts a new one, and so does the first `>` line of a quote and the
 * first line after it. A stray backtick in one block therefore never pairs
 * with one in the next and hides a real tag between them. A line that opens
 * an HTML block, and every line after it up to a blank one, holds no span at
 * all: GitHub reads those lines as HTML, where a backtick is a character, so
 * two stray ones there cannot hide the real closer between them.
 */

export type CodeSpanRange = [number, number]

/** The tags a line opens an HTML block with (CommonMark 0.29, 4.6, type 6,
 *  the version GitHub's cmark-gfm follows). */
const HTML_BLOCK_NAMES =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|' +
  'fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|' +
  'menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|' +
  'track|ul'
const HTML_BLOCK_START = new RegExp(`^ {0,3}</?(?:${HTML_BLOCK_NAMES})(?:[ \\t>]|/>|$)`, 'i')

/** What the run of lines being gathered is: a paragraph's, a quote's, or a
 *  list item's. */
type RunKind = 'prose' | 'quote' | 'item'

/** Every code span in `text`'s prose, as [start, end) in order. `isFence`
 *  says a line is a fence's placeholder (markdown-fences.ts). */
export function proseCodeSpans(text: string, isFence: (line: string) => boolean): CodeSpanRange[] {
  const spans: CodeSpanRange[] = []
  if (!text.includes('`')) {
    return spans
  }
  const lines = text.split('\n')
  const rows = text.includes('|') ? pipeTableRows(lines) : []
  // Where the run of lines being gathered starts, or -1, and what it is.
  let run = -1
  let kind: RunKind = 'prose'
  const endRun = (end: number): void => {
    if (run !== -1) {
      for (const span of markdownCodeSpans(text.slice(run, end), true)) {
        spans.push([run + span.index, run + span.end])
      }
      run = -1
    }
  }
  const startRun = (at: number, next: RunKind): void => {
    endRun(at)
    run = at
    kind = next
  }
  let html = false
  let offset = 0
  lines.forEach((line, index) => {
    const end = offset + line.length
    if (line.trim() === '') {
      html = false
      endRun(offset)
    } else if (html || isFence(line)) {
      endRun(offset)
    } else if (HTML_BLOCK_START.test(line)) {
      html = true
      endRun(offset)
    } else if (rows[index] || HEADING.test(line) || HR.test(line)) {
      startRun(offset, 'prose')
      endRun(end)
    } else if (QUOTE.test(line)) {
      if (run === -1 || kind !== 'quote') {
        startRun(offset, 'quote')
      }
    } else if (ORDERED.test(line) || UNORDERED.test(line)) {
      startRun(offset, 'item')
    } else if (run === -1 || kind === 'quote' || (kind === 'item' && !/^\s/.test(line))) {
      startRun(offset, 'prose')
    }
    offset = end + 1
  })
  endRun(text.length)
  return spans
}
