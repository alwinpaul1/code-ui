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
 * Inline code, as the Claude app draws it: the words' own face on a faint
 * pill with a little padding, sitting on their baseline. Its text is set
 * from the words around it, a paragraph's, a heading's, a list item's or a
 * cell's, at MARKDOWN_CHIP_TEXT_RATIO of their size. It was a fixed 14 sp
 * whatever held it, a third smaller than an h1's words (2026-09-28,
 * HANDOVER.md).
 *
 * The ratio: the Claude app's pill against its words, from a screenshot of
 * the Android app (2026-09-28): an x-height of 17 px against the words' 20,
 * an ascender of 25 px against 29, so 0.85 of its words. Its face is
 * narrower than Instrument Sans, and Code UI's words are set smaller to wrap
 * where its words wrap, so at 0.9 of them Code UI's pill text is the Claude
 * pill's own size in dp: an x-height of 6.4 dp in both.
 *
 * The pill's line holds its text's ink and little more:
 * MARKDOWN_CHIP_LINE_RATIO of its text, the 16.5 dp it had at 14 sp.
 * Instrument Sans's ascent plus descent is 1.22 em (970 + 250 of 1000, hhea
 * of the bundled TTF); its ASCII ink runs from 215 below the baseline (g, j)
 * to 830 above ($). Android rounds the metrics to whole pixels and takes the
 * odd pixel of a negative leading off the descent (CustomLineHeightSpan), and
 * the pill's Text clips at its height: a 16 dp line at 14 sp cut up to 0.9 px
 * off g and j (2026-09-27 review, densities 2.625 to 3.5); 16.5 cleared them
 * at all five. What the line still cuts is given back as room for ink
 * (markdownChipInkRoom).
 */
export const MARKDOWN_CHIP_TEXT_RATIO = 0.9
export const MARKDOWN_CHIP_LINE_RATIO = 16.5 / 14
export const MARKDOWN_CHIP_FONT_SIZE = MARKDOWN_BASE_SIZE * MARKDOWN_CHIP_TEXT_RATIO
export const MARKDOWN_CHIP_LINE_HEIGHT = MARKDOWN_CHIP_FONT_SIZE * MARKDOWN_CHIP_LINE_RATIO
/** A table cell's own type at no zoom; it follows the zoom as prose does
 *  (markdownZoomedLine), and its pills are set from it. */
export const MARKDOWN_TABLE_CELL_FONT_SIZE = MARKDOWN_BASE_SIZE - 2
export const MARKDOWN_TABLE_CELL_LINE_HEIGHT = MARKDOWN_BASE_SIZE + MARKDOWN_PROSE_LINE_GAP
export const MARKDOWN_TABLE_CHIP_FONT_SIZE = MARKDOWN_TABLE_CELL_FONT_SIZE * MARKDOWN_CHIP_TEXT_RATIO
export const MARKDOWN_TABLE_CHIP_LINE_HEIGHT = MARKDOWN_TABLE_CHIP_FONT_SIZE * MARKDOWN_CHIP_LINE_RATIO
/** 2 dp more below a cell's text than above it, as since 2026-09-14. */
export const MARKDOWN_TABLE_CELL_PADDING_BOTTOM = 6
export const MARKDOWN_CHIP_PADDING_VERTICAL = 0
export const MARKDOWN_CHIP_PADDING_HORIZONTAL = 4
export const MARKDOWN_CHIP_BORDER_WIDTH = 1
export const MARKDOWN_CHIP_RADIUS = 7

/**
 * Room for ink above and below the pill's text line, per sp of its text,
 * given back in negative margin so the pill is no bigger. The pill's Text
 * clips at its own height (TextView.onDraw), and the font's ink runs past its
 * line: the ring of Å and Ů to 986 above the baseline, a comma below (ș ļ ķ)
 * to 296 below (glyf of the bundled TTF), past the 970 and 250 its line is
 * built from; Android's whole-pixel metrics take up to a pixel more (review
 * of c3e62696, clipped by up to 3.5 px). 1.25 and 2 dp at 14 sp, sized for a
 * system font size of 130%, which grows the type and not this. Drawn only as
 * whole pixels: see markdownChipInkRoom.
 */
export const MARKDOWN_CHIP_INK_ROOM_TOP = 1.25 / 14
export const MARKDOWN_CHIP_INK_ROOM_BOTTOM = 2 / 14
/** What a whole number of pixels is nudged by. Divided by the density and
 *  multiplied back it can land a hair under itself (3 / 2.625 * 2.625 does,
 *  in doubles), and Fabric floors it; nudged, it floors to itself, and Yoga,
 *  which takes a height within 1e-4 px of a whole pixel as whole, still
 *  does. */
const PIXEL_NUDGE = 1e-5

const INSTRUMENT_SANS_ASCENT = 0.97
const INSTRUMENT_SANS_DESCENT = 0.25
/** How far the font's ink reaches past the 970 and 250 its line is built
 *  from: the ring of Å to 986 above, a comma below to 296 (glyf of the
 *  bundled TTF). */
const INK_ABOVE = 0.986
const INK_BELOW = 0.296
/** Pixels on top of that for Android's whole-pixel type: font metrics
 *  rounded (Paint.getFontMetricsInt), the odd pixel of a negative leading
 *  taken off the descent (CustomLineHeightSpan), and the font size rounded
 *  up to a pixel (TextAttributes.kt). One sufficed in the look test's model,
 *  which leaves the last out. */
const METRIC_PIXELS = 2

/**
 * A pill's room for ink, each side in dp that come to a whole number of
 * pixels at `density`, at least MARKDOWN_CHIP_INK_ROOM_* of its text size,
 * and more where the line is tight on the type as drawn: `sp` turns sizes
 * into dp at the system font size (android-font-scale.ts). `pills` are the
 * text sizes and lines (sp) it serves, by default a paragraph's pill and a
 * table cell's at `zoom`.
 *
 * Android 14 scales the line height on the same curve as the type, which at
 * 150% to 200% leaves a line well short of the type's own 970 and 250 (at
 * 200%, 28.5 dp of line for 26 dp of type); a line that short is centred on
 * the type (CustomLineHeightSpan), so the ink runs past it by half the
 * shortfall each side, and the ring of Å and a comma below were clipped by
 * up to 5.5 px (review of 63858e9e).
 *
 * Only then does the room below draw. Fabric gives a Text its padding as
 * floor(dp * density) pixels (FabricMountingManager.cpp), and Yoga rounds a
 * text node with a fractional height in pixels up at its bottom
 * (PixelGrid.cpp), so the view comes out a pixel taller than its layout and
 * padding; TextView.onDraw then clips at the bottom of its
 * content box, not of its padding, unless the layout fills that box exactly.
 * A room of 1.25 and 2 dp left the comma below clipped by 1.9 to 4.2 px at
 * densities 2.625, 2.75, 3 and 3.5 (review of 4c2732f4). The room above
 * draws either way.
 */
export function markdownChipInkRoom(
  density: number,
  zoom = 1,
  sp: (size: number) => number = (size) => size,
  pills: readonly (readonly [fontSize: number, lineHeight: number])[] = [
    [MARKDOWN_CHIP_FONT_SIZE * zoom, MARKDOWN_CHIP_LINE_HEIGHT * zoom],
    [MARKDOWN_TABLE_CHIP_FONT_SIZE * zoom, MARKDOWN_TABLE_CHIP_LINE_HEIGHT * zoom]
  ]
): { top: number; bottom: number } {
  let top = 0
  let bottom = 0
  for (const [size, line] of pills) {
    const type = sp(size)
    const short = Math.max(0, ((INSTRUMENT_SANS_ASCENT + INSTRUMENT_SANS_DESCENT) * type - sp(line)) / 2)
    top = Math.max(
      top,
      MARKDOWN_CHIP_INK_ROOM_TOP * size,
      (INK_ABOVE - INSTRUMENT_SANS_ASCENT) * type + short + METRIC_PIXELS / density
    )
    bottom = Math.max(
      bottom,
      MARKDOWN_CHIP_INK_ROOM_BOTTOM * size,
      (INK_BELOW - INSTRUMENT_SANS_DESCENT) * type + short + METRIC_PIXELS / density
    )
  }
  const whole = (dp: number) => (Math.ceil(dp * density - PIXEL_NUDGE) + PIXEL_NUDGE) / density
  return { top: whole(top), bottom: whole(bottom) }
}

/** sp to dp and back at the system font size (android-font-scale.ts). */
type SpToDp = { toDp: (sp: number) => number; toSp: (dp: number) => number }
const SP_IS_DP: SpToDp = { toDp: (value) => value, toSp: (value) => value }

/**
 * How a pill sits on a line of words `size` sp, at the system font size
 * `sp`: its text's size and line (sp), the height of the frame Android lays
 * out for it (dp), and how far the pill is drawn from that frame's top.
 *
 * RN hangs an inline view's placeholder from its line's baseline
 * (TextLayoutManager: top = baseline - height), and the placeholder's height
 * is an ascent for its line, with no descent (TextInlineViewPlaceholderSpan).
 * The whole pill as that placeholder was taller than the words' ascent, so it
 * grew the ascent of every line it sat on and pushed that line's words down
 * inside it, two dp off the rhythm of the lines around (2026-09-28,
 * HANDOVER.md, `zz-review-*`); and a line of nothing but pills, with no
 * descent at all, was shared out lower still, its pill's bottom past the
 * line (2026-09-27's pill on a 25 dp line reached 25.46).
 *
 * So the view Android lays out is a frame as tall as the words' ascent less
 * their descent. That is under their ascent, so it takes nothing from any
 * line, and a line of pills alone, whose ascent it is, is shared out exactly
 * as a line of words: the same baseline (CustomLineHeightSpan centres a line
 * on its ascent and descent). The pill hangs from the frame, drawn `shift`
 * up so its text sits on the words' baseline (MobileMarkdownCodeChip). The
 * frame is given through sp's inverse, since RN sizes the placeholder with
 * toPixelFromSP of the frame.
 *
 * Given the words' line height too (sp), a pill that would reach within
 * MARKDOWN_CHIP_LINE_MARGIN of its line's edge is drawn up or down to keep
 * that clear, off the baseline by as little: Android 14's curve at 200%
 * leaves an h2's line 1.17 times its type, and a pill on the baseline ran
 * 0.4 dp out of the bottom of it.
 */
export type MarkdownChipGeometry = {
  fontSize: number
  lineHeight: number
  frame: number
  shift: number
}

export const MARKDOWN_CHIP_LINE_MARGIN = 1

export function markdownChipGeometry(
  size: number,
  sp: SpToDp = SP_IS_DP,
  wordsLineHeight?: number
): MarkdownChipGeometry {
  const fontSize = size * MARKDOWN_CHIP_TEXT_RATIO
  const lineHeight = fontSize * MARKDOWN_CHIP_LINE_RATIO
  const words = sp.toDp(size)
  const text = sp.toDp(fontSize)
  const line = sp.toDp(lineHeight)
  const placeholder = (INSTRUMENT_SANS_ASCENT - INSTRUMENT_SANS_DESCENT) * words
  const edge = MARKDOWN_CHIP_BORDER_WIDTH + MARKDOWN_CHIP_PADDING_VERTICAL
  const baseline = edge + INSTRUMENT_SANS_ASCENT * text + (line - (INSTRUMENT_SANS_ASCENT + INSTRUMENT_SANS_DESCENT) * text) / 2
  let shift = placeholder - baseline
  if (wordsLineHeight !== undefined) {
    // The words' line, shared out around their ascent and descent
    // (CustomLineHeightSpan), and the pill's box, about the baseline.
    const lineBox = sp.toDp(wordsLineHeight)
    const lineAbove = INSTRUMENT_SANS_ASCENT * words + (lineBox - (INSTRUMENT_SANS_ASCENT + INSTRUMENT_SANS_DESCENT) * words) / 2
    const lineBelow = lineBox - lineAbove
    const boxAbove = baseline
    const boxBelow = line + 2 * edge - baseline
    const room = lineBox - 2 * MARKDOWN_CHIP_LINE_MARGIN - (boxAbove + boxBelow)
    if (room < 0) {
      // No room for the margin: centred in the line.
      shift += (lineBelow - lineAbove - (boxBelow - boxAbove)) / 2
    } else {
      shift -= Math.max(0, boxBelow - (lineBelow - MARKDOWN_CHIP_LINE_MARGIN))
      shift += Math.max(0, boxAbove - (lineAbove - MARKDOWN_CHIP_LINE_MARGIN))
    }
  }
  return { fontSize, lineHeight, frame: sp.toSp(placeholder), shift }
}

export function markdownProseScale(
  size: number,
  textScale: number
): { fontSize: number; lineHeight: number } | null {
  // The pill's 1px borders do NOT scale — a hairline stays a hairline — so at
  // a small zoom they eat the gap the line height is there to provide. Adding
  // them back keeps the clear air between two wrapped pills constant at every
  // zoom instead of shrinking it away (markdownZoomedLine).
  return markdownZoomedLine(size, size + MARKDOWN_PROSE_LINE_GAP, textScale)
}

export type MarkdownChipScale = {
  factor: number
  /** A paragraph's pill at this zoom. */
  fontSize: number
  lineHeight: number
  paddingVertical: number
  paddingHorizontal: number
  borderRadius: number
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
    borderRadius: MARKDOWN_CHIP_RADIUS * textScale
  }
}

/**
 * A line of text at the reader's zoom: its size and line height scaled, and
 * the pill's two 1 dp borders added back, which do not scale (as for prose,
 * markdownProseScale). Headings and table cells used to keep their size at a
 * zoom while their pills grew, and pills on two wrapped lines met from zoom
 * 1.35 (review of c3e62696). Null when the reader has not zoomed.
 */
export function markdownZoomedLine(
  fontSize: number,
  lineHeight: number,
  textScale: number
): { fontSize: number; lineHeight: number } | null {
  if (textScale === 1) {
    return null
  }
  return { fontSize: fontSize * textScale, lineHeight: lineHeight * textScale + 2 * MARKDOWN_CHIP_BORDER_WIDTH }
}

/** What a paragraph's pill paints, top to bottom, at a given zoom. */
export function markdownChipFootprint(textScale: number): number {
  const chip = markdownChipScale(textScale)
  const lineHeight = chip?.lineHeight ?? MARKDOWN_CHIP_LINE_HEIGHT
  const padding = chip?.paddingVertical ?? MARKDOWN_CHIP_PADDING_VERTICAL
  return lineHeight + 2 * padding + 2 * MARKDOWN_CHIP_BORDER_WIDTH
}
