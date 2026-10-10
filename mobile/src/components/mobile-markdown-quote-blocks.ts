import type { Token, Tokens } from 'marked'
import type { MobileMarkdownBlock, MobileMarkdownQuoteMember } from './mobile-markdown-parser'
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
 * What the quote holds is Markdown of its own (2026-10-10, an email draft
 * quoted in a reply, beside the Claude app): paragraphs, headings, rules and
 * lists are the same blocks they are outside a quote, drawn inside the bar the
 * way they are drawn outside it, bullets hanging and all. The quote kept them
 * as one text before, a list as its raw `- ` lines and every paragraph
 * filled into one line, so the email's list read "- IRMER training", its
 * details ran together and its sign-off was one line. Inside a quote every
 * newline is a line break (breakProse in mobile-markdown-prose-fill.ts).
 *
 * A quote inside this one is a member with members of its own and a bar of
 * its own; a fence in it still comes out, as a quoted code block. A list with
 * a fence under one of its items (decided 2026-10-01: draw it as code, as
 * GitHub and marked do) goes through the parser's own list conversion, which
 * takes the fence out after its item. A list whose conversion holds a block
 * the bar cannot hold (a table, a quote) is its raw source, as is a table,
 * an HTML block or a link definition.
 */

/** How many bars deep a quote is drawn. Each bar insets the text by its
 *  width and is a View of its own, so twenty levels left no width at all
 *  (review, 2026-10-10); a quote deeper than this is its source, `>` and all,
 *  inside the deepest bar, as every inner quote was drawn before. */
export const MAX_QUOTE_BARS = 4

type QuotePart = { members: MobileMarkdownQuoteMember[] } | { code: Extract<MobileMarkdownBlock, { type: 'code' }> }

function quoteParts(
  token: Tokens.Blockquote,
  reflow: (text: string) => string,
  convert: (tokens: Token[]) => MobileMarkdownBlock[],
  bars = 1
): QuotePart[] {
  const parts: QuotePart[] = []
  let members: MobileMarkdownQuoteMember[] = []
  const flush = (): void => {
    if (members.length > 0) {
      parts.push({ members })
      members = []
    }
  }
  /** Its source, with each `<br>` the HTML pass kept on the quote's lines
   *  (markBlockLineBreaks) a newline, as one was before the pass kept it. */
  const addSource = (raw: string): void => {
    const text = inlineBreaksAsNewlines(raw).replace(/\n+$/, '')
    if (text.trim()) {
      members.push({ type: 'paragraph', text })
    }
  }
  for (const child of token.tokens) {
    if (child.type === 'paragraph') {
      const text = reflow((child as Tokens.Paragraph).text)
      if (text.trim()) {
        members.push({ type: 'paragraph', text })
      }
    } else if (child.type === 'heading') {
      members.push({ type: 'heading', level: (child as Tokens.Heading).depth, text: reflow((child as Tokens.Heading).text) })
    } else if (child.type === 'hr') {
      members.push({ type: 'rule' })
    } else if (child.type === 'code') {
      flush()
      for (const block of convert([child])) {
        if (block.type === 'code') {
          parts.push({ code: block })
        }
      }
    } else if (child.type === 'list') {
      const blocks = convert([child])
      if (blocks.every((block) => block.type === 'list' || block.type === 'code')) {
        for (const block of blocks) {
          if (block.type === 'code') {
            flush()
            parts.push({ code: block })
          } else if (block.type === 'list') {
            members.push(block)
          }
        }
      } else {
        addSource(child.raw)
      }
    } else if (child.type === 'blockquote' && bars >= MAX_QUOTE_BARS) {
      addSource(child.raw)
    } else if (child.type === 'blockquote') {
      for (const part of quoteParts(child as Tokens.Blockquote, reflow, convert, bars + 1)) {
        if ('members' in part) {
          members.push({ type: 'quote', members: part.members })
        } else {
          flush()
          parts.push(part)
        }
      }
    } else if (child.type !== 'space') {
      addSource(child.raw)
    }
  }
  flush()
  return parts
}

/**
 * A blockquote's blocks: its Markdown as quote blocks, and each fence in it as
 * a code block between them. `reflow` and `convert` are the parser's own prose
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
      'members' in part
        ? { type: 'quote', members: part.members, ...joins }
        : { ...part.code, quoted: true, ...joins }
    )
  }
  // A quote with nothing in it (a lone `>`) is still the empty quote block it
  // always was.
  return blocks.length > 0 ? blocks : [{ type: 'quote', members: [] }]
}
