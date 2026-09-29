/**
 * Cutting a user-visible string at a length cap without cutting a character in
 * half.
 *
 * A JavaScript string is UTF-16: an emoji, any other character outside the
 * Basic Multilingual Plane, or one of the bold/mono letterforms notification
 * text carries emphasis in (notification-plain-text.ts) is a surrogate pair,
 * two code units. `text.slice(0, n)` counts code units, so a cut that lands
 * between the two leaves a lone high surrogate, which Android draws as a
 * broken glyph or a replacement box.
 *
 * The caps stay counted in code units, the unit of `String.length`, so a cap a
 * caller already had keeps meaning what it meant: a string that fitted still
 * fits whole, and a cut is never longer than it was. The one change is that a
 * cut which would end on the first half of a pair ends one code unit sooner,
 * before the whole character.
 *
 * Grapheme clusters are out of scope: a cut can still fall inside a ZWJ
 * sequence (a family emoji), between a flag's two regional indicators, or
 * before a skin-tone modifier. Each piece left is a whole character that draws
 * as itself, never as a replacement box, and finding cluster boundaries needs
 * `Intl.Segmenter`, which this app does not count on under Hermes.
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/** The first `maxUnits` UTF-16 code units of `text`, or one fewer when the
 *  last of them is the first half of a surrogate pair. */
export function cutWholeCharacters(text: string, maxUnits: number): string {
  if (maxUnits <= 0) {
    return ''
  }
  if (text.length <= maxUnits) {
    return text
  }
  const end = isHighSurrogate(text.charCodeAt(maxUnits - 1)) ? maxUnits - 1 : maxUnits
  return text.slice(0, end)
}

/** `text` itself when it is at most `maxUnits` code units long; otherwise its
 *  first `maxUnits - 1`, cut by `cutWholeCharacters`, and an ellipsis. The
 *  result is never longer than `maxUnits`. */
export function clipWithEllipsis(text: string, maxUnits: number): string {
  if (text.length <= maxUnits) {
    return text
  }
  return maxUnits <= 0 ? '' : `${cutWholeCharacters(text, maxUnits - 1)}…`
}
