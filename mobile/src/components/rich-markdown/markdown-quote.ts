import { renderInline } from './markdown-inline-render'
import { closesFence, fencedCodeHtml, openingFence, outdentCodeLine } from './markdown-code-fence'
import { indentedCodeHtml, readIndentedCode } from './markdown-leaf-blocks'

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
