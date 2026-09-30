import { openingFence } from './markdown-code-fence'
import { opensTable } from './markdown-table-rows'

/**
 * A lazy continuation line (CommonMark 5.1 and 5.2): a line under a list item's or a quote's
 * paragraph, left of the item's words or with no `>`, that is still that paragraph's. It is how a
 * hard-wrapped README or doc is written: '- first line\nsecond line' is one item, and
 * '> first line\nsecond line' one quote.
 *
 * The editor read no such line until 2026-09-30: the item or the quote ended above it and a save
 * wrote a blank line there, so the wrapped words left it and became a paragraph of their own, cut
 * mid-sentence.
 *
 * A lazy line only continues a paragraph: never after a blank line, a fence or indented code, which
 * each reader checks for itself. After a table inside a quote it is a paragraph of the quote's own,
 * behind a blank quote line, as marked reads it (markdown-quote.ts): until 2026-10-01 it was saved
 * under the table as one more row. Under a list item it is never after a heading (any `#`) or a
 * rule either, which ends the item there (markdown-list-parse.ts): until 2026-10-01 '- # H\nlazy'
 * saved as the one heading '- # H lazy'. And it is never a line that opens a block, which is what
 * this says. The set is marked's (the desktop's reader) where it is wider than CommonMark's:
 * any marker, an empty one too, any `#`, and a tag or an autolink at the start of the line all end
 * the item. Where the two readers disagree the line ends the item or the quote, as every line at
 * the margin did before, rather than guess.
 */

/** A list marker at any indent, with words or none; a `#`, a `>` or a tag up to three columns in. */
const LAZY_LINE_OPENER = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)|^ {0,3}(?:#|>|<[A-Za-z/!?])/

/**
 * A thematic break: one of `-`, `*` or `_` three or more times, with spaces or tabs between them
 * allowed (CommonMark 4.1), as the PR renderer's HR reads it. The rule test took only an unbroken
 * run, so `* * *` and `- - -` read as a bullet holding the rest of the marks and saved as a list
 * item, and `_ _ _` as words (review, 2026-09-30).
 *
 * A break wins over a list item where a line could be either, as in CommonMark. Any indent, as the
 * editor's rule test has always allowed rather than CommonMark's three columns: an indented `---`
 * under a list item has always ended the item as a rule, and three columns would gather it into
 * the item's words instead. Here, beside the lazy line's test that needs it, because the quote
 * reader imports that test and the list reader imports the quote reader: this module imports none
 * of them. It lived in the list reader until 2026-09-30.
 */
export function isThematicBreak(line: string): boolean {
  return /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)
}

/**
 * Whether a line continues the paragraph above it lazily: it has words, and opens no block of its
 * own. `under` is the line below it, since a table opens on two.
 */
export function continuesParagraphLazily(line: string, under: string | undefined): boolean {
  return (
    line.trim() !== '' &&
    !LAZY_LINE_OPENER.test(line) &&
    !isThematicBreak(line) &&
    openingFence(line) === null &&
    !opensTable(line, under)
  )
}
