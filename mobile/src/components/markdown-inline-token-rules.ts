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

/** An email address as CommonMark reads one between angle brackets, as a
 *  RegExp source: `<noreply@anthropic.com>` is a link that writes to it. */
export const EMAIL_AUTOLINK_SOURCE =
  "[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*"

/** An autolink as the address it opens, the words drawn for it, and the
 *  text drawn after it. An address in angle brackets opens whole, closing
 *  punctuation and all: CommonMark takes the brackets as its bounds. An email
 *  address in them is drawn as itself and opens a `mailto:`. A bare address
 *  leaves sentence punctuation behind. */
export function autolinkParts(token: string): { url: string; words: string; trailing: string } {
  if (!token.startsWith('<')) {
    const { url, trailing } = trimAutolinkTrailingPunctuation(token)
    return { url, words: url, trailing }
  }
  const words = token.slice(1, -1)
  return { url: words.includes(':') ? words : `mailto:${words}`, words, trailing: '' }
}
