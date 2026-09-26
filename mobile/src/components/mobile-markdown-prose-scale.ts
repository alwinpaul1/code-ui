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

/**
 * Inline code, as the Claude app draws it (two screenshots, 2026-09-26): the
 * paragraph's own face one step smaller, on a faint pill with a little
 * padding, sitting on the paragraph's baseline. JetBrains Mono at 13 with 5 dp
 * of padding read wider and bulkier than the words around it.
 *
 * Instrument Sans's ascent plus descent is 1.22 em (970 + 250 of 1000, hhea of
 * the bundled TTF): 17.1 dp at 14, so a 17 dp line holds the glyphs and no
 * air. The pill's height comes from that line and its 1 dp border alone.
 */
export const MARKDOWN_CHIP_FONT_SIZE = MARKDOWN_BASE_SIZE - 1
export const MARKDOWN_CHIP_LINE_HEIGHT = 17
/** A table cell is set at BASE - 2; its pills match the cell's own size. */
export const MARKDOWN_TABLE_CHIP_FONT_SIZE = MARKDOWN_BASE_SIZE - 2
export const MARKDOWN_TABLE_CHIP_LINE_HEIGHT = 16
export const MARKDOWN_CHIP_PADDING_VERTICAL = 0
export const MARKDOWN_CHIP_PADDING_HORIZONTAL = 4
export const MARKDOWN_CHIP_BORDER_WIDTH = 1
export const MARKDOWN_CHIP_RADIUS = 7
const INSTRUMENT_SANS_ASCENT = 0.97
const INSTRUMENT_SANS_DESCENT = 0.25

/**
 * How far a pill is drawn below where Android lays it, so its text sits on
 * the paragraph's baseline. Android hangs an inline view's BOTTOM on the
 * baseline (TextLayoutManager: top = baseline - height), so the pill's own
 * text rides above the words by its border, its padding, and the part of its
 * line below its baseline. 4 dp for both pill sizes (4.46 and 4.32).
 */
export function markdownChipBaselineShift(fontSize: number, lineHeight: number): number {
  const leading = lineHeight - (INSTRUMENT_SANS_ASCENT + INSTRUMENT_SANS_DESCENT) * fontSize
  return (
    MARKDOWN_CHIP_BORDER_WIDTH +
    MARKDOWN_CHIP_PADDING_VERTICAL +
    INSTRUMENT_SANS_DESCENT * fontSize +
    leading / 2
  )
}

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

export type MarkdownChipScale = {
  factor: number
  fontSize: number
  lineHeight: number
  paddingVertical: number
  paddingHorizontal: number
  borderRadius: number
  baselineShift: number
}

export function markdownChipScale(textScale: number): MarkdownChipScale | null {
  if (textScale === 1) {
    return null
  }
  return {
    factor: textScale,
    fontSize: MARKDOWN_CHIP_FONT_SIZE * textScale,
    lineHeight: MARKDOWN_CHIP_LINE_HEIGHT * textScale,
    paddingVertical: MARKDOWN_CHIP_PADDING_VERTICAL * textScale,
    paddingHorizontal: MARKDOWN_CHIP_PADDING_HORIZONTAL * textScale,
    borderRadius: MARKDOWN_CHIP_RADIUS * textScale,
    baselineShift:
      markdownChipBaselineShift(MARKDOWN_CHIP_FONT_SIZE, MARKDOWN_CHIP_LINE_HEIGHT) * textScale
  }
}

/** What the pill actually paints, top to bottom, at a given zoom. */
export function markdownChipFootprint(textScale: number): number {
  const chip = markdownChipScale(textScale)
  const lineHeight = chip?.lineHeight ?? MARKDOWN_CHIP_LINE_HEIGHT
  const padding = chip?.paddingVertical ?? MARKDOWN_CHIP_PADDING_VERTICAL
  return lineHeight + 2 * padding + 2 * MARKDOWN_CHIP_BORDER_WIDTH
}
