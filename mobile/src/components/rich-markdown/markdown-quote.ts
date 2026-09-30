import { renderInline } from './markdown-inline-render'
import { closesFence, fencedCodeHtml, openingFence, outdentCodeLine } from './markdown-code-fence'
import { indentedCodeHtml, readIndentedCode } from './markdown-leaf-blocks'
import { continuesParagraphLazily, isThematicBreak } from './markdown-lazy-line'
import { opensTable } from './markdown-table-rows'

/**
 * A quote's inside, on the reading half of the round trip: its paragraphs, and the code blocks and
 * quotes nested in it, each a block of its own inside the `<blockquote>`.
 *
 * Until 2026-09-30 a quote's lines were one run of words, so a fenced block's backticks became an
 * inline code span: '> ```\n> x\n> ```' saved as '> ```x```', and a tilde fence as strikethrough.
 * A quote holding a quote was words too, and a fence inside that one was lost the same way.
 */

/**
 * The attribute on a block of a quote that its source wrote with no blank quote line before it:
 * words straight after a fence, a fence breaking into words. A save writes a bare `>` line between
 * a quote's blocks otherwise (html-block-markdown.ts).
 */
export const QUOTE_TIGHT_ATTRIBUTE = 'data-md-quote-tight'

/**
 * How many quotes deep, the outermost counted, quotes inside quotes are read. Past this the rest is words, as a quote's
 * inside always was: the chat's parser pins 12,000 levels (mobile-markdown-parser-progress.test.ts),
 * and one call a level would overflow the stack on that document, or cost a pass over its lines per
 * level.
 */
const NESTED_QUOTE_LIMIT = 8

/** A quote line with its marker and one space after it off, or null when the line is not one. */
export function quoteLineContent(line: string): string | null {
  return line.startsWith('>') ? line.replace(/^>\s?/, '') : null
}

/** Four columns of indent, where a line with no words above it opens indented code. */
const INDENTED_CODE = /^(?: {4}| {0,3}\t)/

/**
 * Whether a line ends a table's rows, as marked reads them, besides a blank line, a fence and a
 * quote: indented code, a heading, a rule, or a list that may break into a paragraph (a bullet, or
 * an item numbered 1). Any other line is one more row to marked, with pipes or without.
 */
function endsTableRows(line: string): boolean {
  return (
    INDENTED_CODE.test(line) ||
    /^ {0,3}#{1,6}(?:\s|$)/.test(line) ||
    isThematicBreak(line) ||
    /^ {0,3}(?:[-*+]|1[.)])[ \t]/.test(line)
  )
}

/**
 * Where a lazy line goes: behind `markers` (none for the quote's own paragraph, one `> ` more per
 * quote nested in it), and after a blank quote line where it opens a paragraph rather than
 * continuing one.
 */
type LazyPlace = { markers: string; opensParagraph: boolean }

/** A quote's lines as they are read, as far as a lazy line after them cares. */
type QuoteTail = {
  take: (line: string) => void
  /** Where a lazy line goes after the lines so far, or null when the quote ends above it. */
  lazyPlace: () => LazyPlace | null
}

/** A list item's marker, as marked opens one inside a quote. */
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/

/**
 * A quote's lines, markers off, fed one at a time, read the way `quoteBlocks` reads them: a fence
 * runs to its closing fence, a run of marked lines is a quote nested in it, a blank line ends a
 * paragraph, and a line four columns in with no words above it is code. One pass, so a long quote
 * with a lazy line every other line costs no more than its length.
 *
 * A table is read as marked reads it too, its header over its separator and then its rows up to a
 * line `endsTableRows` names, although the quote draws its lines as words. A lazy line after its
 * rows opens a paragraph of its own. Until 2026-10-01 they counted as paragraph text, and a save
 * wrote the lazy line straight under them, where marked read it as one more row. A table under a
 * list item is the item's to marked, and so is a lazy line after it, which a save writes under it
 * as before: a list item is taken to hold the lines after its marker until a heading (any `#`) or a
 * rule breaks it, or a line at the quote's margin comes after a blank line, a fence or a quote.
 */
function quoteTail(depth: number): QuoteTail {
  let fence: string | null = null
  let paragraph = false
  let table = false
  /** The line before, where it is words that may be a table's header. */
  let header: string | null = null
  /** Whether a list item may still hold the lines, as marked reads them. */
  let listed = false
  let blank = false
  let nested: QuoteTail | null = null
  return {
    take(line) {
      const afterBlank = blank
      blank = !line.trim()
      if (fence !== null) {
        fence = closesFence(line, fence) ? null : fence
        return
      }
      const atMargin = !/^[ \t]/.test(line)
      const quoted = depth < NESTED_QUOTE_LIMIT ? quoteLineContent(line) : null
      if (quoted !== null) {
        paragraph = table = false
        header = null
        listed &&= !atMargin
        nested ??= quoteTail(depth + 1)
        nested.take(quoted)
        return
      }
      nested = null
      const opened = openingFence(line)
      if (blank || opened !== null) {
        paragraph = table = false
        header = null
        listed &&= !(opened !== null && atMargin)
        fence = opened?.fence ?? null
        return
      }
      if (table && !endsTableRows(line)) {
        return
      }
      listed &&= !(afterBlank && atMargin)
      table = !listed && header !== null && opensTable(header, line)
      if (table) {
        paragraph = false
        header = null
        return
      }
      if (/^ {0,3}#/.test(line) || isThematicBreak(line)) {
        listed = false
      } else {
        listed ||= LIST_ITEM.test(line)
      }
      const indented = INDENTED_CODE.test(line)
      paragraph ||= !indented
      header = !indented && continuesParagraphLazily(line, undefined) ? line : null
    },
    lazyPlace() {
      if (fence !== null) {
        return null
      }
      if (nested !== null) {
        const inner = nested.lazyPlace()
        return inner === null ? null : { ...inner, markers: `> ${inner.markers}` }
      }
      if (table || paragraph) {
        return { markers: '', opensParagraph: table }
      }
      return null
    }
  }
}

/** How a quote's lines are told apart from the lines around it. */
export type QuoteLines = {
  /** A line's content with its markers off, where it is one of the quote's marked lines. */
  marked: (line: string) => string | null
  /** Whether a line the quote does not mark may still be one of its lazy lines. */
  mayBeLazy: (line: string) => boolean
  /** The quote's lines read before the first one, markers off: one on an item's marker line. */
  before: readonly string[]
}

const DOCUMENT_QUOTE: QuoteLines = { marked: quoteLineContent, mayBeLazy: () => true, before: [] }

/**
 * A quote's lines from `index`, markers off: its marked lines, and after a paragraph the lazy lines
 * that continue it (markdown-lazy-line.ts), each under the markers that put it in that paragraph,
 * so '> a\nb' reads as '> a\n> b' and '> > a\nb' as '> > a\n> > b'. Until 2026-09-30 the quote
 * ended at the first line with no marker, and a save wrote a blank line there: the wrapped words
 * left the quote. Never after a blank quote line, a fence or indented code, where there is no
 * paragraph to continue. After a table's rows the lazy line is a paragraph of the quote's own, as
 * marked reads it, so a blank quote line goes before it: '> | a |\n> | - |\nb' reads as
 * '> | a |\n> | - |\n>\n> b'.
 */
export function readQuoteLines(
  lines: readonly string[],
  index: number,
  quote: QuoteLines = DOCUMENT_QUOTE
): { lines: string[]; nextIndex: number } {
  const tail = quoteTail(1)
  const read: string[] = []
  const take = (content: string) => {
    read.push(content)
    tail.take(content)
  }
  quote.before.forEach(take)
  let next = index
  while (next < lines.length) {
    const line = lines[next] ?? ''
    const content = quote.marked(line)
    if (content !== null) {
      take(content)
      next += 1
      continue
    }
    const place =
      quote.mayBeLazy(line) && continuesParagraphLazily(line, lines[next + 1]) ? tail.lazyPlace() : null
    if (place === null) {
      break
    }
    if (place.opensParagraph) {
      take(place.markers.trimEnd())
    }
    take(`${place.markers}${line.trimStart()}`)
    next += 1
  }
  return { lines: read, nextIndex: next }
}

/** An element's markup with one more attribute on its opening tag. */
function withAttribute(html: string, attribute: string): string {
  return attribute ? html.replace(/^<([a-z]+)/, `<$1${attribute}`) : html
}

/** A fenced block from its opening line at `index`: up to its closing fence or the quote's end. */
function quotedFenceHtml(
  lines: readonly string[],
  index: number
): { html: string; nextIndex: number } {
  const fence = openingFence(lines[index] ?? '')!
  const code: string[] = []
  let next = index + 1
  while (next < lines.length && !closesFence(lines[next] ?? '', fence.fence)) {
    code.push(outdentCodeLine(lines[next] ?? '', fence.indent))
    next += 1
  }
  return { html: fencedCodeHtml(fence, code), nextIndex: Math.min(next + 1, lines.length) }
}

/**
 * The blocks of a quote whose lines, markers off, are `lines`. A blank quote line ends a paragraph,
 * and a save writes it back as a bare `>` (it was two breaks inside one paragraph until 2026-09-30,
 * and saved as `> ` with a trailing space). Inside a paragraph every source line is still drawn on
 * its own line, with its hard-break spaces or backslash left in its text. A fence or a nested quote breaks into words, as
 * CommonMark lets it; an indented code block needs a blank line or a block before it, or it is words.
 */
function quoteBlocks(lines: readonly string[], depth: number): string {
  const blocks: string[] = []
  let paragraph: string[] = []
  let afterBlank = true
  const push = (html: string) => {
    blocks.push(withAttribute(html, afterBlank ? '' : ` ${QUOTE_TIGHT_ATTRIBUTE}="true"`))
    afterBlank = false
  }
  const flush = () => {
    if (paragraph.length > 0) {
      push(`<p>${renderInline(paragraph.join('\n').trim()).replace(/\n/g, '<br />')}</p>`)
    }
    paragraph = []
  }
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      flush()
      afterBlank = true
      index += 1
      continue
    }
    if (openingFence(line) !== null) {
      flush()
      const fenced = quotedFenceHtml(lines, index)
      push(fenced.html)
      index = fenced.nextIndex
      continue
    }
    if (depth < NESTED_QUOTE_LIMIT && quoteLineContent(line) !== null) {
      flush()
      const inner: string[] = []
      while (index < lines.length && quoteLineContent(lines[index] ?? '') !== null) {
        inner.push(quoteLineContent(lines[index] ?? '')!)
        index += 1
      }
      push(quoteHtml(inner, '', depth + 1))
      continue
    }
    const indented = paragraph.length === 0 ? readIndentedCode(lines, index, 0) : null
    if (indented !== null) {
      push(indentedCodeHtml(indented.code))
      index = indented.nextIndex
      continue
    }
    paragraph.push(line)
    index += 1
  }
  flush()
  return blocks.join('')
}

/**
 * A quote's lines, markers off, as its markup. `attributes` go on the `<blockquote>`: where a list
 * item's quote sits (markdown-list-render.ts). An empty quote still holds a paragraph, which is
 * where the caret goes.
 */
export function quoteHtml(lines: readonly string[], attributes = '', depth = 1): string {
  return `<blockquote${attributes}>${quoteBlocks(lines, depth) || '<p></p>'}</blockquote>`
}
