import { createMarkdownCodeSpanFinder } from './markdown-code-spans'
import { maskMarkdownEscapes } from './markdown-inline-escapes'
import { createMarkdownLinkFinder } from './markdown-inline-links'
import { EMAIL_AUTOLINK_SOURCE } from './markdown-inline-token-rules'

export type MarkdownInlineMatch = {
  0: string
  index: number
  end: number
  /** A link's or an image's words and address, as written. A label can hold
   *  a whole image and an address balanced parentheses
   *  (markdown-inline-links.ts), so neither is read back off the token. */
  link?: { image: boolean; label: string; href: string }
  /** For a token of the caller's pattern: the first capture group that
   *  matched it, which says what it is where its text cannot. */
  group?: number
}

/** The inline tokens a chat reply draws besides links and code spans:
 *  strike, bold, italic and web addresses. One source for the renderer and for the
 *  reply's plain-text copy (markdown-plain-text.ts), so a mark the screen
 *  draws as style is never left on the clipboard. A fresh regex per call: the
 *  matcher moves its `lastIndex`.
 *
 *  A bold span may hold whole italic spans of its own character: `***x***`
 *  is bold around `*x*`, and `**a *b* c**` bold around `*b*`. The renderer
 *  reads a bold token's inside again, so the italic draws by itself. A bold
 *  span that could hold no star drew `***x***` as `*`, bold x, `*`, and put
 *  the stars on the clipboard too (review, 2026-09-30). An inner italic must
 *  start on a character that is not a space, so `Name: *** Date: ***` and
 *  `___ Date: ___`, blanks to fill in, stay as they were. Every alternative
 *  inside the group starts on a different character, so the pattern stays
 *  linear.
 *
 *  An italic span may hold whole bold spans the same way, on one line:
 *  `*a **b** c*` is italic around `**b**`, and `***x** y*` italic around
 *  `**x**`. An italic that could hold no star drew b not bold, and drew
 *  `***x** y*` as `*`, bold x, ` y*` (review, 2026-09-30). The same rules:
 *  an inner bold starts on a character that is not a space, and a bold is
 *  still tried first where one opens, so `***x***` stays bold around italic.
 *  So a token's first characters no longer say what it is: `***x** y*` is
 *  an italic. Each kind is a capture group of its own, and the matcher says
 *  which one matched (`group`, BOLD_TOKEN_GROUP).
 *
 *  An address in angle brackets, `<https://x.dev/a>`, is an autolink with
 *  the brackets as its bounds, as in CommonMark. A bare address ends at
 *  either bracket: it ran on through `>`, so `<https://x.dev/a>` drew its
 *  brackets and opened `https://x.dev/a>` (review, 2026-09-30). So are
 *  `<mailto:…>` and an email address, `<noreply@anthropic.com>`; an address
 *  of any other scheme stays as written. */
export function markdownInlineTokenPattern(): RegExp {
  return new RegExp(INLINE_TOKEN_SOURCE, 'g')
}

const INLINE_TOKEN_SOURCE = [
  /(~~[^~]+~~)/.source,
  /(\*\*(?:[^*]|\*[^*\s][^*\n]*\*)+\*\*|__(?:[^_]|_[^_\s][^_\n]*_)+__)/.source,
  /(\*(?:[^*\n]|\*\*[^*\s][^*\n]*\*\*)+\*|_(?:[^_\n]|__[^_\s][^_\n]*__)+_)/.source,
  `(${/<https?:\/\/[^\s<>]+>|<mailto:[^\s<>]+>/.source}|<${EMAIL_AUTOLINK_SOURCE}>|${/https?:\/\/[^\s<>]+/.source})`
].join('|')

/** The capture groups of markdownInlineTokenPattern() a bold token and a
 *  web or email address matched. */
export const BOLD_TOKEN_GROUP = 2
export const ADDRESS_TOKEN_GROUP = 4

/** Merge a global non-link regex with links; search starts must advance between calls. */
export function createMarkdownInlineMatcher(
  text: string,
  nonLinkPattern: RegExp,
  /** A chat reply's reading (MobileMarkdown, its Copy, a link's words):
   *  `![alt](src)` images, a label that holds one, and backslash escapes.
   *  The PR renderer reads none of them. */
  images = false,
  /** Find code spans by backtick RUN, as CommonMark does; the regex must
   *  then carry no backtick rule of its own. */
  codeSpans = false
): { lastIndex: number; exec: () => MarkdownInlineMatch | null } {
  let nextOther: MarkdownInlineMatch | null | undefined
  let nextLink: MarkdownInlineMatch | null | undefined
  let nextCode: MarkdownInlineMatch | null | undefined
  // Marks are looked for where an escaped one cannot be seen; every token is
  // cut from the text itself (markdown-inline-escapes.ts).
  const source = images ? maskMarkdownEscapes(text) : text
  const linkFinder = createMarkdownLinkFinder(source, images)
  const codeSpanFinder = createMarkdownCodeSpanFinder(source, images)
  const other = (index: number, end: number, found?: RegExpExecArray): MarkdownInlineMatch => {
    const group = found ? found.findIndex((value, at) => at > 0 && value !== undefined) : -1
    return group > 0 ? { 0: text.slice(index, end), index, end, group } : { 0: text.slice(index, end), index, end }
  }

  function findLink(from: number): MarkdownInlineMatch | null {
    const span = linkFinder(from)
    if (!span) {
      return null
    }
    const { index, end, image, labelEnd } = span
    return {
      0: text.slice(index, end),
      index,
      end,
      link: { image, label: text.slice(image ? index + 2 : index + 1, labelEnd), href: text.slice(labelEnd + 2, end - 1) }
    }
  }

  /**
   * The next code span at or after `from`, by CommonMark's rule, escapes and
   * all in a chat reply (markdown-code-spans.ts, shared with the HTML pass so
   * the two find the same spans).
   */
  function findCodeSpan(from: number): MarkdownInlineMatch | null {
    const span = codeSpanFinder(from)
    return span ? other(span.index, span.end) : null
  }

  const matcher = {
    lastIndex: 0,
    exec(): MarkdownInlineMatch | null {
      const from = matcher.lastIndex
      if (nextOther === undefined || (nextOther !== null && nextOther.index < from)) {
        nonLinkPattern.lastIndex = from
        const match = nonLinkPattern.exec(source)
        nextOther = match ? other(match.index, nonLinkPattern.lastIndex, match) : null
      }
      if (nextLink === undefined || (nextLink !== null && nextLink.index < from)) {
        nextLink = findLink(from)
      }
      if (codeSpans && (nextCode === undefined || (nextCode !== null && nextCode.index < from))) {
        nextCode = findCodeSpan(from)
      }
      // A code span binds tighter than emphasis (CommonMark): a token that
      // opens before one and closes INSIDE it is not a token. Look again from
      // just past its opener, until the next candidate clears the span. One
      // that closes after the span contains it and stands — the first cut of
      // this dropped "**Alphabetical `/` menu.**" and left the stars literal
      // beside the chip (device, 2026-09-20).
      while (
        codeSpans &&
        nextCode &&
        nextOther &&
        nextOther.index < nextCode.index &&
        nextOther.end > nextCode.index &&
        nextOther.end < nextCode.end
      ) {
        nonLinkPattern.lastIndex = nextOther.index + 1
        const again = nonLinkPattern.exec(source)
        nextOther = again ? other(again.index, nonLinkPattern.lastIndex, again) : null
      }
      let match =
        nextLink && (!nextOther || nextLink.index < nextOther.index) ? nextLink : nextOther
      // Earliest wins; on a tie the code span, since a backtick is never an
      // emphasis or link opener.
      if (codeSpans && nextCode && (!match || nextCode.index <= match.index)) {
        match = nextCode
      }
      if (match) {
        matcher.lastIndex = match.end
      }
      return match
    }
  }
  return matcher
}

/** The text of a code-span token: the backtick runs off, then one space of
 *  padding off each side when both are there and the span is not all spaces
 *  (CommonMark), so `` ` `` `user` `` `` reads `user` and ``` `  two  ` ```
 *  keeps one space each side. */
export function codeSpanContent(token: string): string {
  let run = 0
  while (token[run] === '`') {
    run += 1
  }
  const inner = token.slice(run, token.length - run)
  if (inner.length >= 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim().length > 0) {
    return inner.slice(1, -1)
  }
  return inner
}
