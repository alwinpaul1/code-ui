import {
  ADDRESS_TOKEN_GROUP,
  BOLD_TOKEN_GROUP,
  createMarkdownInlineMatcher,
  markdownInlineTokenPattern,
  type MarkdownInlineMatch
} from '../markdown-inline-matcher'
import {
  afterRefusedUnderscoreOpener,
  autolinkParts,
  isIntrawordUnderscoreToken
} from '../markdown-inline-token-rules'
import { escapeAttr, escapeHtml, escapeLiteralHtml, isSafeUrl } from './markdown-escaping'
import { entitySourceAttribute, entityTextHtml } from './markdown-entity-source'

/**
 * The attribute that says an `<a>` was drawn from an address written bare, `https://x.dev/a`, or
 * in angle brackets, `<https://x.dev/a>`, so html-inline-markdown.ts saves it the way it was
 * written rather than as `[address](address)`.
 */
export const AUTOLINK_ATTRIBUTE = 'data-autolink'

/**
 * The chat's tokens (markdownInlineTokenPattern), and a code span as the editor has always read
 * one, a backtick to the next: the editor saves `<code>` back between single backticks, so a span
 * of CommonMark's longer runs would not come back as it was written. Built per call: the matcher
 * moves its `lastIndex`, and a module here does no work as it is parsed
 * (rich-markdown-document-parse-time.test.ts).
 */
function inlineTokenPattern(): RegExp {
  return new RegExp(`${markdownInlineTokenPattern().source}|(\`[^\`]+\`)`, 'g')
}

/** One token as markup. In a link's words (`inLabel`) an address or a link is text: an `<a>`
 *  inside an `<a>` is no markup a browser keeps, and the words are one link already. */
function tokenHtml(match: MarkdownInlineMatch, inLabel: boolean): string {
  const token = match[0]
  const link = match.link
  if (link) {
    // A `javascript:` address is the one the editor refuses. The token is kept as the text it is,
    // so it saves back as written; it fell through to the italic branch before and saved as
    // `*tap](javascript:alert(1*)`.
    if (!isSafeUrl(link.href) || (inLabel && !link.image)) {
      return entityTextHtml(token)
    }
    return link.image
      ? `<img src="${escapeAttr(link.href)}" alt="${escapeAttr(link.label)}" />`
      : `<a href="${escapeAttr(link.href)}">${renderMarks(link.label, true)}</a>`
  }
  if (match.group === ADDRESS_TOKEN_GROUP) {
    if (inLabel) {
      return entityTextHtml(token)
    }
    const { url, words, trailing } = autolinkParts(token)
    const written = token.startsWith('<') ? 'angle' : 'bare'
    // The words keep their source where it holds an entity, as text does (markdown-entity-source).
    return (
      `<a href="${escapeAttr(url)}" ${AUTOLINK_ATTRIBUTE}="${written}"${entitySourceAttribute(words)}>` +
      `${escapeHtml(words)}</a>${entityTextHtml(trailing)}`
    )
  }
  const inside = (marks: number) => renderMarks(token.slice(marks, -marks), inLabel)
  if (token.startsWith('`')) {
    return `<code>${escapeLiteralHtml(token.slice(1, -1))}</code>`
  }
  if (token.startsWith('~~')) {
    return `<s>${inside(2)}</s>`
  }
  return match.group === BOLD_TOKEN_GROUP ? `<strong>${inside(2)}</strong>` : `<em>${inside(1)}</em>`
}

function renderMarks(text: string, inLabel: boolean): string {
  // Every token opens on one of these, so words without one are text. Most of what a token holds
  // is such words, and making a matcher for each drew a paragraph of 15,000 short italics four
  // times slower.
  if (!/[*_~`[<@]|https?:\/\//.test(text)) {
    return entityTextHtml(text)
  }
  // Images, a label that holds one, and escapes, as the chat reads them (markdown-inline-matcher.ts).
  const matcher = createMarkdownInlineMatcher(text, inlineTokenPattern(), true)
  let output = ''
  let lastIndex = 0
  let match = matcher.exec()
  while (match !== null) {
    // An underscore inside a word is text, as CommonMark reads it and as the chat renderer already
    // did: taking `_case_` in `snake_case_name` for italics saved it back as `snake*case*name`.
    // Only its opener is refused: the scan goes on past the opener's underscore run, as the chat's
    // does, so a span inside it still draws. Writing the whole match out as text left the backticks
    // of "my_var and `code` and other_var" in the document (review, 2026-09-30).
    if (isIntrawordUnderscoreToken(text, match.index, match[0])) {
      matcher.lastIndex = afterRefusedUnderscoreOpener(text, match.index)
      match = matcher.exec()
      continue
    }
    output += entityTextHtml(text.slice(lastIndex, match.index)) + tokenHtml(match, inLabel)
    lastIndex = match.end
    match = matcher.exec()
  }
  return output + entityTextHtml(text.slice(lastIndex))
}

/**
 * One line of markdown as inline markup: images, code, strikethrough, emphasis, links and
 * addresses, with everything between them escaped.
 *
 * Links, addresses and emphasis are read by the chat's matcher and grammar
 * (markdown-inline-matcher.ts), so a document reads the way a reply does. The editor read its own
 * rules before: a label to the first `]`, an address to the first `)`, and a bare address on
 * through `)`, `>` and a closing full stop. Opening a document and saving it therefore rewrote the
 * user's links (review, 2026-09-30): a README badge, `[![CI](b.svg)](r)`, saved as
 * `[![CI](b.svg)]([r)](r))`, `(see https://x.dev/a) now` as `(see [https://x.dev/a)](…)) now`, and
 * every bare address as `[address](address)`. An address is now drawn as a link marked with
 * AUTOLINK_ATTRIBUTE, which saves back bare or in its brackets.
 *
 * A bold span may hold whole italic spans of its own character, and an italic whole bold spans
 * (markdown-inline-matcher.ts has the why): `***x***` is bold around `*x*`, drawn as nested marks,
 * and it saves back as it was. `\*\*[^*]+\*\*` drew it as a star, bold x, a star, and the stars
 * were then text in the document (review, 2026-09-30). Every emphasis starts and ends on a
 * character that is not a space (emphasisSource), so prose maths is text: `x ** 2 and y ** 3` drew
 * as `x <strong> 2 and y </strong> 3`, and an edit inside that bold saved the user's maths as
 * bold (same review).
 *
 * A backslash escape makes its mark literal, as in a reply: `\*not italic\*` draws its stars and
 * saves back as written. The backslash itself stays in the text, as it always has here.
 */
export function renderInline(text: string): string {
  return renderMarks(text, false)
}
