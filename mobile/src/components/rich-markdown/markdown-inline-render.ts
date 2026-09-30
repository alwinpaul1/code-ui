import { isIntrawordUnderscoreToken } from '../markdown-inline-token-rules'
import { escapeAttr, escapeHtml, isSafeUrl } from './markdown-escaping'

/**
 * One line of markdown as inline markup: images, code, strikethrough, emphasis, links and bare
 * URLs, with everything between them escaped.
 *
 * The pattern is built per call rather than shared: it is a global regex read with `exec`, so a
 * module-level one would carry its `lastIndex` into the next call — and this function recurses
 * into its own matches, so the next call is usually itself.
 *
 * A bold span may hold whole italic spans of its own character, as the chat's
 * markdownInlineTokenPattern does (markdown-inline-matcher.ts has the why): `***x***` is bold
 * around `*x*`, drawn as nested marks, and it saves back as it was. `\*\*[^*]+\*\*` drew it as a
 * star, bold x, a star, and the stars were then text in the document (review, 2026-09-30).
 */
export function renderInline(text: string): string {
  const pattern =
    /(!\[[^\]]*\]\([^)]+\)|`[^`]+`|~~[^~]+~~|\*\*(?:[^*]|\*[^*\s][^*\n]*\*)+\*\*|__(?:[^_]|_[^_\s][^_\n]*_)+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<]+)/g
  let output = ''
  let lastIndex = 0
  let match = pattern.exec(text)
  while (match !== null) {
    const token = match[0]
    // An underscore inside a word is text, as CommonMark reads it and as the chat renderer already
    // did: taking `_case_` in `snake_case_name` for italics saved it back as `snake*case*name`.
    // Only its opener is refused: the scan goes on from the next character, as the chat's does, so
    // a span inside it still draws. Writing the whole match out as text left the backticks of
    // "my_var and `code` and other_var" in the document (review, 2026-09-30).
    if (isIntrawordUnderscoreToken(text, match.index, token)) {
      pattern.lastIndex = match.index + 1
      match = pattern.exec(text)
      continue
    }
    output += escapeHtml(text.slice(lastIndex, match.index))
    const image = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (image && isSafeUrl(image[2])) {
      output += `<img src="${escapeAttr(image[2]!)}" alt="${escapeAttr(image[1] ?? '')}" />`
    } else if (link && isSafeUrl(link[2])) {
      output += `<a href="${escapeAttr(link[2]!)}">${renderInline(link[1]!)}</a>`
    } else if (/^https?:\/\//i.test(token)) {
      output += `<a href="${escapeAttr(token)}">${escapeHtml(token)}</a>`
    } else if (token.startsWith('`')) {
      output += `<code>${escapeHtml(token.slice(1, -1))}</code>`
    } else if (token.startsWith('~~')) {
      output += `<s>${renderInline(token.slice(2, -2))}</s>`
    } else if (token.startsWith('**') || token.startsWith('__')) {
      output += `<strong>${renderInline(token.slice(2, -2))}</strong>`
    } else {
      output += `<em>${renderInline(token.slice(1, -1))}</em>`
    }
    lastIndex = pattern.lastIndex
    match = pattern.exec(text)
  }
  return output + escapeHtml(text.slice(lastIndex))
}
