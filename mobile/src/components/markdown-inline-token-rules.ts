// Post-checks for inline markdown tokens that a single-pass tokenizer regex
// cannot express on its own.

// Letters, digits and combining marks of every script, not `\w`'s ASCII: `你好_强调_世界` is one
// word to CommonMark, and reading it as emphasis made the rich editor save `*` in its place.
const INTRAWORD_FLANK_PATTERN = /[\p{L}\p{N}\p{M}_\\/]/u

/**
 * True when a `_…_` / `__…__` token sits inside a word (snake_case, dunder
 * tails). CommonMark treats intraword underscores as literal text; path
 * separators count as flanks so dunder path segments also stay whole.
 */
export function isIntrawordUnderscoreToken(text: string, index: number, token: string): boolean {
  if (!token.startsWith('_')) {
    return false
  }
  const prev = index > 0 ? text[index - 1]! : ''
  const next = text[index + token.length] ?? ''
  return INTRAWORD_FLANK_PATTERN.test(prev) || INTRAWORD_FLANK_PATTERN.test(next)
}

/**
 * Where the scan goes on after an intraword underscore token at `index` is refused: past the
 * underscore run it opens with. A token opening anywhere else in that run has `_` before it, which
 * isIntrawordUnderscoreToken refuses too, so nothing is lost; but finding each one cost a scan,
 * and from the second underscore of `a__b__` an italic holding bold spans runs to the end of the
 * text before it closes. Going on one character at a time did that once per underscore: copying
 * `a__b__` 20,000 times took 6.7 s (review, 2026-09-30).
 */
export function afterRefusedUnderscoreOpener(text: string, index: number): number {
  let end = index + 1
  while (text[end] === '_') {
    end += 1
  }
  return end
}

/**
 * Split sentence punctuation off an autolinked URL tail ("see https://x.com/a."),
 * keeping a trailing ')' only when the URL itself opened a paren.
 */
export function trimAutolinkTrailingPunctuation(url: string): { url: string; trailing: string } {
  let end = url.length
  let parenthesisCountsReady = false
  let openParentheses = 0
  let closeParentheses = 0
  while (end > 0) {
    const char = url[end - 1]!
    if ('.,;:!?'.includes(char)) {
      end--
      continue
    }
    if (char === ')') {
      if (!parenthesisCountsReady) {
        for (let index = 0; index < end; index++) {
          if (url[index] === '(') {
            openParentheses++
          } else if (url[index] === ')') {
            closeParentheses++
          }
        }
        parenthesisCountsReady = true
      }
      if (closeParentheses > openParentheses) {
        end--
        closeParentheses--
        continue
      }
    }
    break
  }
  return { url: url.slice(0, end), trailing: url.slice(end) }
}

/**
 * A bold (`width` 2) or italic (`width` 1) of one mark, `\\*` or `_`, as a
 * RegExp source, for the chat (markdown-inline-matcher.ts), the rich editor
 * and PR comments, so the three read one grammar.
 *
 * Its inside starts and ends on a character that is not a space: CommonMark
 * opens no emphasis on a run with a space after it and closes none on a run
 * with a space before it. Every star in `x ** 2 + y ** 2` and `2 * 3 * 4` has
 * a space on both sides, and an inside of "any character but the mark" drew
 * " 2 + y " bold and copied "2  3  4" (review, 2026-09-30). So a blank to
 * fill in, `Name: *** Date: ***`, is text too.
 *
 * Written as a first piece, then a run of spaces and a piece at a time, so a
 * match can only end on a piece: `\S(?:.*\S)?` without a choice of where the
 * last `\S` goes. A piece is one character that is neither the mark nor a
 * space, or, where `holdsOtherWidth`, a whole span of the other width with
 * the same rule (`***x***` is bold around `*x*`, `*a **b** c*` italic around
 * `**b**`). Only the inner span starts on the mark, so no two alternatives
 * compete for a character and the pattern stays linear on text that never
 * closes. An inner span stays on one line; the outer one crosses a line break
 * where `overLines`.
 */
export function emphasisSource(mark: '\\*' | '_', width: 1 | 2, overLines: boolean, holdsOtherWidth = true): string {
  const open = mark.repeat(width)
  const inner = mark.repeat(3 - width)
  const word = `[^${mark}\\s]`
  const piece = holdsOtherWidth ? `(?:${word}|${inner}${word}(?:[^${mark}\\n]*${word})?${inner})` : word
  return `${open}${piece}(?:${overLines ? '\\s' : '[^\\S\\n]'}*${piece})*${open}`
}

/** An email address as CommonMark reads one between angle brackets, as a
 *  RegExp source: `<noreply@anthropic.com>` is a link that writes to it. */
export const EMAIL_AUTOLINK_SOURCE =
  "[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*"

/** A bare email address, as GFM's extended autolink reads one: `a.b+c@x.co`
 *  with no brackets is a link that writes to it, as the Claude app draws it
 *  (an email draft quoted in a reply, 2026-10-10). The domain holds at least
 *  one dot and ends on a letter or digit, so a sentence's full stop is left
 *  behind. Narrower than GFM in one place: the last label starts with a
 *  letter and is two characters at least, because an agent writes package
 *  versions (`react@18.3.1`) far more often than an address at a numeric
 *  domain. Not after a character that would make it part of something else:
 *  `ssh://git@host.dev`, `@scope/pkg@1.2.3` and `src/icon@2x.png` are not
 *  addresses. */
export const BARE_EMAIL_AUTOLINK_SOURCE =
  '(?<![A-Za-z0-9._+\\-/:@])[A-Za-z0-9._+-]+@[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*\\.[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]'

/** An autolink as the address it opens, the words drawn for it, and the
 *  text drawn after it. An address in angle brackets opens whole, closing
 *  punctuation and all: CommonMark takes the brackets as its bounds. An email
 *  address in them is drawn as itself and opens a `mailto:`, and so does a
 *  bare one. A bare web address leaves sentence punctuation behind. */
export function autolinkParts(token: string): { url: string; words: string; trailing: string } {
  if (!token.startsWith('<') && !/^https?:/i.test(token)) {
    return { url: `mailto:${token}`, words: token, trailing: '' }
  }
  if (!token.startsWith('<')) {
    const { url, trailing } = trimAutolinkTrailingPunctuation(token)
    return { url, words: url, trailing }
  }
  const words = token.slice(1, -1)
  return { url: words.includes(':') ? words : `mailto:${words}`, words, trailing: '' }
}
