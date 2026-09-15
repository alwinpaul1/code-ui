/** Prose base size. Declared HERE, not imported from the style sheet, so this
 *  module stays free of react-native and its invariants can be tested as plain
 *  arithmetic; the style sheet imports it back. */
export const MARKDOWN_BASE_SIZE = 15

/**
 * Prose and inline-chip sizes at the reader's pinch zoom.
 *
 * Two things went wrong when this lived inline in the component (device
 * screenshot, 2026-09-15: chips drawn on top of the words beside them).
 *
 * The line height was recomputed as `(size + 8) * scale`, quietly overriding
 * the `+10` the static paragraph style carries. That `+10` is not a taste: it is
 * the gap an inline code pill needs, because Android ignores an inline View's
 * vertical margins and the line height is the only separation there is. The
 * collision test pinned it on the STATIC styles, so nothing noticed the scaled
 * path breaking the same invariant.
 *
 * And the pill did not scale at all. Its text and padding are fixed, so at any
 * zoom the prose moved and the pill did not — too big beside shrunken text, and
 * past the line height it no longer fits in, which is the overlap.
 *
 * So both move together, by the same factor, keeping the same headroom.
 */
export const MARKDOWN_PROSE_LINE_GAP = 10
/** The pill's own line height at scale 1; `+1` clears the mono descenders. */
export const MARKDOWN_CHIP_LINE_GAP = 1
export const MARKDOWN_CHIP_PADDING_VERTICAL = 1
export const MARKDOWN_CHIP_BORDER_WIDTH = 1

export function markdownProseScale(
  size: number,
  textScale: number
): { fontSize: number; lineHeight: number } | null {
  if (textScale === 1) {
    return null
  }
  return {
    fontSize: size * textScale,
    // The pill's 1px borders do NOT scale — a hairline stays a hairline — so at
    // a small zoom they eat the gap the line height is there to provide. Adding
    // them back keeps the clear air between two wrapped pills constant at every
    // zoom instead of shrinking it away.
    lineHeight: (size + MARKDOWN_PROSE_LINE_GAP) * textScale + 2 * MARKDOWN_CHIP_BORDER_WIDTH
  }
}

export function markdownChipScale(textScale: number): {
  fontSize: number
  lineHeight: number
  paddingVertical: number
  borderRadius: number
} | null {
  if (textScale === 1) {
    return null
  }
  return {
    fontSize: (MARKDOWN_BASE_SIZE - 2) * textScale,
    lineHeight: (MARKDOWN_BASE_SIZE + MARKDOWN_CHIP_LINE_GAP) * textScale,
    paddingVertical: MARKDOWN_CHIP_PADDING_VERTICAL * textScale,
    borderRadius: 7 * textScale
  }
}

/** What the pill actually paints, top to bottom, at a given zoom. */
export function markdownChipFootprint(textScale: number): number {
  const chip = markdownChipScale(textScale)
  const lineHeight = chip?.lineHeight ?? MARKDOWN_BASE_SIZE + MARKDOWN_CHIP_LINE_GAP
  const padding = chip?.paddingVertical ?? MARKDOWN_CHIP_PADDING_VERTICAL
  return lineHeight + 2 * padding + 2 * MARKDOWN_CHIP_BORDER_WIDTH
}
