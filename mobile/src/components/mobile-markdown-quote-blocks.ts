import type { Token, Tokens } from 'marked'
import type { MobileMarkdownBlock } from './mobile-markdown-parser'
import { inlineBreaksAsNewlines } from './markdown-inline-breaks'

/**
 * A quote, as a run of blocks rather than a single one.
 *
 * Everything in a quote used to be kept in ONE quote block's text: its prose
 * reflowed, and every other child as its raw source, fence lines included.
 * The screen drew that text through the inline pass and the reply's Copy read
 * it through the same pass, which took a fence's backticks for a code span
 * running across lines and its tildes for strikethrough: `> ~~~` / `> a` /
 * `> ~~~` drew and copied as `~`, `a`, `~`, a fence's language drew as a word,
 * an unclosed fence showed its own backticks and ate the code's, and each
 * fence left a stray newline at both ends (review, 2026-09-30). A list item
 * had the same defect with the same cause, and its fix is the precedent here
 * (flattenList in mobile-markdown-parser.ts): the fence comes out of the
 * text, goes through the same conversion as every other block, and the quote
 * resumes after it. That is what gives it the code block's scroller, its Copy
 * button and the mermaid routing.
 *
 * A fence that came out of a quote is `quoted`, so it is drawn inside the
 * quote's bar, and every block after a quote's first `continuesQuote`, so its
 * bar joins the one above it: one quote still reads as one bar, however many
 * blocks it is cut into. Two quotes a blank line apart are two quotes, as they
 * always were.
 *
 * A quote inside this one is read the same way, so a fence in it comes out
 * too. Its words keep the `>` they were drawn with (they are the inner
 * quote's), and fill the width as the outer quote's always have. Any other
 * child (a heading, a list, a table) is still its raw source in the quote's
 * text, as before, so a fence under a list item INSIDE a quote is still drawn
 * as that text: taking it out would mean drawing a list inside the bar.
 */

type QuotePart = { prose: string } | { code: Extract<MobileMarkdownBlock, { type: 'code' }> }

/** An inner quote's words as its source marked them, blank lines as a bare `>`. */
function markedAsQuoted(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
}

function quoteParts(
  token: Tokens.Blockquote,
  reflow: (text: string) => string,
  convert: (tokens: Token[]) => MobileMarkdownBlock[]
): QuotePart[] {
  const parts: QuotePart[] = []
  const prose: string[] = []
  const flush = (): void => {
    if (prose.length > 0) {
      parts.push({ prose: prose.join('\n\n') })
      prose.length = 0
    }
  }
  const addProse = (text: string): void => {
    if (text.trim()) {
      prose.push(text)
    }
  }
  for (const child of token.tokens) {
    if (child.type === 'paragraph') {
      addProse(reflow((child as Tokens.Paragraph).text))
    } else if (child.type === 'code') {
      flush()
      for (const block of convert([child])) {
        if (block.type === 'code') {
          parts.push({ code: block })
        }
      }
    } else if (child.type === 'blockquote') {
      for (const part of quoteParts(child as Tokens.Blockquote, reflow, convert)) {
        if ('prose' in part) {
          addProse(markedAsQuoted(part.prose))
        } else {
          flush()
          parts.push(part)
        }
      }
    } else {
      // Its source, with each `<br>` the HTML pass kept on the quote's lines
      // (markBlockLineBreaks) a newline, as one was before the pass kept it.
      addProse(inlineBreaksAsNewlines(child.raw).replace(/\n+$/, ''))
    }
  }
  flush()
  return parts
}

/**
 * A blockquote's blocks: its words as quote blocks, and each fence in it as a
 * code block between them. `reflow` and `convert` are the parser's own prose
 * fill and block conversion, passed in so this module needs nothing from the
 * parser at run time.
 */
export function quoteBlocks(
  token: Tokens.Blockquote,
  reflow: (text: string) => string,
  convert: (tokens: Token[]) => MobileMarkdownBlock[]
): MobileMarkdownBlock[] {
  const blocks: MobileMarkdownBlock[] = []
  for (const part of quoteParts(token, reflow, convert)) {
    const joins = blocks.length > 0 ? { continuesQuote: true } : null
    blocks.push(
      'prose' in part
        ? { type: 'quote', text: part.prose, ...joins }
        : { ...part.code, quoted: true, ...joins }
    )
  }
  // A quote with nothing in it (a lone `>`) is still the empty quote block it
  // always was.
  return blocks.length > 0 ? blocks : [{ type: 'quote', text: '' }]
}
