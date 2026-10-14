import { markdownDocumentSource, normalizeMobileMarkdownPreviewHtml } from '../components/mobile-markdown-preview-html'
import { parseMobileMarkdown, type MobileMarkdownBlock } from '../components/mobile-markdown-parser'

/**
 * Which sent prompts are drawn as Markdown. The Claude app (1.261009.20)
 * sends a prompt's text through the same Markdown composable as a reply
 * (yy20.e, with the reply's code-block card), so bold, bullets, fences and
 * `code` come out formatted. Only a slash command is a chip of its own
 * (m330.java:27804, `rro`). Code UI drew the characters instead: literal
 * `**6. Check memory pressure**` and ``` fences (screenshot, 2026-10-14).
 *
 * Not every prompt goes through the document. Most are a line of words, and
 * the plain bubble line costs a Text where the document costs a parse, a run
 * of styles and a selection root, in every row of a long chat. So a prompt is
 * drawn as Markdown only when it holds something Markdown would draw
 * differently, and that is read cheaply first: one pass for the marks, then
 * the parse the document would do anyway (cached by its source, so the
 * document gets it for nothing).
 */

/** Past this many characters a prompt is drawn as the plain line it was
 *  before. A paste this long that is also full of code spans is hundreds of
 *  pills inside one row, each cut to its line and measured again after every
 *  layout (use-markdown-code-pill-runs.ts); a reply's own long text is drawn
 *  by the native view on Android, which a bubble is not. About three screens
 *  of this phone's text, past what anyone writes and past most of what a
 *  Claude answer pasted back is. */
export const USER_MARKDOWN_MAX_CHARS = 12_000

/** Past this many marks that can open emphasis (`*`, `~`, an `_` that starts a
 *  word) a prompt is drawn plain too. The parser pairs every unmatched opener
 *  against the rest of the text, so its time grows with the square of them:
 *  3000 stray `**a ` in 12,000 characters took 1.5 s on a laptop, 300 of them
 *  (600 marks) 15 ms (measured 2026-10-14), and a pasted log or glob listing
 *  can hold that many. A written document holds far fewer: the pasted answer
 *  this was made for has 24 in 1,600 characters. */
export const USER_MARKDOWN_MAX_EMPHASIS_MARKS = 600

/** And past this many backticks. Code spans cost the parser nothing, but each
 *  is a pill, a View of its own, and 500 of them in one bubble is a stall of
 *  views, not a document (use-markdown-code-pill-runs.ts). The same answer
 *  has 44. */
export const USER_MARKDOWN_MAX_BACKTICKS = 1000

/** A slash command: `/loop check job 2888`, `/plugin:cmd`. The name is
 *  followed by a space or the end, so a path (`/Users/me/app`) is not one. */
const SLASH_COMMAND = /^\s*\/[A-Za-z][\w.:-]*(?:\s|$)/

/** The marks of a block, at the start of a line: a heading, a quote, a bullet,
 *  a numbered step, a rule, a table row. */
const BLOCK_MARK =
  /^[ \t]{0,3}(?:#{1,6}[ \t]+\S|>[ \t]?\S|[-*+][ \t]+\S|\d{1,9}[.)][ \t]+\S|(?:-{3,}|\*{3,}|_{3,})[ \t]*$|\|.*\|[ \t]*$)/m

/** The marks inside a line: a code span or a fence, bold, strike, an
 *  emphasis with its closing mark on the line, a link, a web address. */
const INLINE_MARK = /`|\*\*\S|__\S|~~\S|\*[^\s*][^*\n]*\*|(?:^|[\s(])_[^\s_][^_\n]*_(?:[\s.,;:!?)]|$)|\]\(|https?:\/\/\S/

const WORD_CHARACTER = /\w/

export function isSlashCommandPrompt(text: string): boolean {
  return SLASH_COMMAND.test(text)
}

/** Whether the text holds more marks than the document is worth drawing. */
function overMarkBudget(text: string): boolean {
  let emphasis = 0
  let backticks = 0
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at)
    if (code === 96) {
      backticks += 1
    } else if (code === 42 || code === 126 || (code === 95 && (at === 0 || !WORD_CHARACTER.test(text[at - 1]!)))) {
      emphasis += 1
    }
    if (emphasis > USER_MARKDOWN_MAX_EMPHASIS_MARKS || backticks > USER_MARKDOWN_MAX_BACKTICKS) {
      return true
    }
  }
  return false
}

/** Whether the document would draw anything of it. A lone fence, an empty
 *  bullet or a bare `#` parse to nothing (or to an empty card), and a bubble
 *  of nothing is worse than the characters. */
function blockDraws(block: MobileMarkdownBlock): boolean {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'code':
      return block.text.trim() !== ''
    case 'list':
      return block.items.length > 0
    case 'quote':
      return block.members.length > 0
    case 'table':
      return block.headers.length > 0
    case 'image':
    case 'rule':
      return true
    default: {
      const unhandled: never = block
      return unhandled
    }
  }
}

/** Whether a sent prompt is drawn as the Markdown document. The same source
 *  and line-break rule the document is given (MobileNativeChatProse). */
export function userTextDrawsAsMarkdown(text: string): boolean {
  if (text.length > USER_MARKDOWN_MAX_CHARS || isSlashCommandPrompt(text)) {
    return false
  }
  if (!INLINE_MARK.test(text) && !BLOCK_MARK.test(text)) {
    return false
  }
  if (overMarkBudget(text)) {
    return false
  }
  const source = markdownDocumentSource(text)
  return parseMobileMarkdown(normalizeMobileMarkdownPreviewHtml(source), true).some(blockDraws)
}
