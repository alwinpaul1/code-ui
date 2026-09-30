/**
 * Backslash escapes in a chat reply, as CommonMark reads them: a backslash
 * before ASCII punctuation makes that character literal and is not drawn.
 * `\*not bold\*` is two stars around words, `off\!` is `off!`, and `\\` is one
 * backslash. A backslash before anything else is itself: `C:\Users\x` keeps
 * both.
 *
 * None of this was read before (review, 2026-09-30): the phone drew
 * `\*not bold\*` as "\", italic "not bold\", and put that on the clipboard.
 * Two halves, both used by MobileMarkdown's renderInline and by the reply's
 * Copy (markdown-plain-text.ts), so they cannot disagree:
 *
 * - The matcher looks for marks in a MASKED copy of the text
 *   (markdown-inline-matcher.ts), where every escaped character is a
 *   stand-in no pattern takes for a mark, so an escaped star neither opens
 *   nor closes emphasis. Every index still lines up with the text, and the
 *   tokens are cut from the text itself, so the stand-in is never drawn.
 * - A run of plain text between tokens drops the backslash of each escape.
 *   Code and a link's address are never text runs, so they keep theirs.
 */

/** A backslash and the ASCII punctuation it escapes, as a RegExp source, the
 *  character its first capture; the PR reader's entity pass reads escapes in
 *  the same pass (markdown-html-entities.ts). */
export const MARKDOWN_ESCAPE_SOURCE = '\\\\([!-/:-@[-`{-~])'
/** ASCII punctuation: what a backslash escapes. */
const ESCAPED = new RegExp(MARKDOWN_ESCAPE_SOURCE, 'g')
/** A run of backslashes, and the character after it if there is one. */
const BACKSLASH_RUN = /\\+([\s\S]?)/g
/** In the masked text, the character an escape made literal. Private use,
 *  so it is no mark and no space to any pattern. */
const STAND_IN = '\uE0FF'
const ESCAPABLE = /^[!-/:-@[-`{-~]$/

/** Plain text as drawn: the backslash off every escape. */
export function unescapeMarkdownText(text: string): string {
  return text.includes('\\') ? text.replace(ESCAPED, '$1') : text
}

/**
 * The text with every escaped character swapped for a stand-in, the same
 * length. In a run of backslashes each second one is escaped by the one
 * before it; an odd run escapes the punctuation after it. A backtick is left
 * as it is: a backslash inside a code span is literal, so whether a backtick
 * is escaped depends on where the spans are, which the matcher's code-span
 * finder decides (an escaped backtick only fails to OPEN one). In the masked
 * text, a character is escaped exactly when a backslash is right before it.
 */
export function maskMarkdownEscapes(text: string): string {
  if (!text.includes('\\')) {
    return text
  }
  return text.replace(BACKSLASH_RUN, (run: string, after: string) => {
    const slashes = run.length - after.length
    const pairs = `\\${STAND_IN}`.repeat(slashes >> 1)
    if (slashes % 2 === 0) {
      return pairs + after
    }
    return `${pairs}\\${after !== '`' && ESCAPABLE.test(after) ? STAND_IN : after}`
  })
}
