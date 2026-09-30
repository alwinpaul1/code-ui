import { MARKDOWN_ESCAPE_SOURCE } from './markdown-inline-escapes'

/**
 * The HTML entities a Markdown reader draws as characters: the chat's HTML
 * pass (mobile-markdown-preview-html.ts), and a PR comment's text runs and
 * link addresses (parseInline in pr-sidebar/markdown-blocks.ts), read one
 * table. A PR comment drew `Vec&lt;T&gt;` as written (review, 2026-09-30),
 * where GitHub and the chat draw `Vec<T>`.
 *
 * One pass, so an entity is decoded once: `&amp;lt;` is `&lt;`, never `<`.
 * A bare `&` and a name not in the table stay as written. `&nbsp;` is a plain
 * space, as the chat always drew it.
 */
const NAMED: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' }
const NAMED_SOURCE = '&(nbsp|lt|gt|quot|#39|amp);'
/** With `numeric`, a decimal or hexadecimal character reference too. */
const NUMERIC_SOURCE = '&#(?:(\\d{1,7})|[xX]([0-9a-fA-F]{1,6}));'

const NAMED_ENTITY = new RegExp(NAMED_SOURCE, 'gi')
const ANY_ENTITY = new RegExp(`${NAMED_SOURCE}|${NUMERIC_SOURCE}`, 'gi')
/** A backslash escape or an entity, whichever comes first. */
const ESCAPE_OR_ENTITY = new RegExp(`${MARKDOWN_ESCAPE_SOURCE}|${NAMED_SOURCE}|${NUMERIC_SOURCE}`, 'gi')

/** The character a numeric reference names, or null for one that names none
 *  (0, a surrogate, past U+10FFFF): it stays as written. */
function codePointText(value: number): string | null {
  return value > 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff) ? String.fromCodePoint(value) : null
}

function decoded(whole: string, name?: string, decimal?: string, hex?: string): string {
  if (name !== undefined) {
    return NAMED[name.toLowerCase()] ?? whole
  }
  const value = decimal !== undefined ? Number(decimal) : hex !== undefined ? Number.parseInt(hex, 16) : Number.NaN
  return codePointText(value) ?? whole
}

/** `value` with its entities decoded; numeric references only with `numeric`. */
export function decodeMarkdownHtmlEntities(value: string, numeric = false): string {
  if (!value.includes('&')) {
    return value
  }
  return numeric
    ? value.replace(ANY_ENTITY, (whole: string, name?: string, decimal?: string, hex?: string) => decoded(whole, name, decimal, hex))
    : value.replace(NAMED_ENTITY, (whole: string, name: string) => decoded(whole, name))
}

/**
 * A run of plain text as drawn: each backslash escape's backslash off
 * (markdown-inline-escapes.ts) and each entity decoded, in one pass, so an
 * escaped `&` opens no entity (`\&amp;` is `&amp;`) and the character an
 * entity stands for is never read again.
 */
export function markdownTextRunWithEntities(value: string): string {
  if (!value.includes('&') && !value.includes('\\')) {
    return value
  }
  return value.replace(
    ESCAPE_OR_ENTITY,
    (whole: string, escaped?: string, name?: string, decimal?: string, hex?: string) =>
      escaped !== undefined ? escaped : decoded(whole, name, decimal, hex)
  )
}
