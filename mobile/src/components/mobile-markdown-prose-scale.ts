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
 * The pill's line holds its text's ink and little more. Instrument Sans's
 * ascent plus descent is 1.22 em (970 + 250 of 1000, hhea of the bundled
 * TTF); its ASCII ink runs from 215 below the baseline (g, j) to 830 above
 * ($). Android rounds the metrics to whole pixels and takes the odd pixel of
 * a negative leading off the descent (CustomLineHeightSpan), and the pill's
 * Text clips at its height: at 16 dp that cut up to 0.9 px off g and j
 * (2026-09-27 review, densities 2.625 to 3.5). 16.5 clears them at all five,
 * with a tenth of a pixel to spare at the tightest.
 *
 * The pill's height is that line and its border, and it has to sit a dp
 * inside the line it is drawn in: 17 left an h4 heading's pill 0.04 dp
 * inside (2026-09-27 review). At 16.5 the pill's text sits half a dp above
 * the paragraph's baseline to keep that dp (MARKDOWN_CHIP_LIFT): the trade
 * is half a dp of baseline for whole descenders and the margin.
 */
export const MARKDOWN_CHIP_FONT_SIZE = MARKDOWN_BASE_SIZE - 1
export const MARKDOWN_CHIP_LINE_HEIGHT = 16.5
/** A table cell is set at BASE - 2; its pills match the cell's own size. */
export const MARKDOWN_TABLE_CHIP_FONT_SIZE = MARKDOWN_BASE_SIZE - 2
export const MARKDOWN_TABLE_CHIP_LINE_HEIGHT = 15.5
/** How far above the paragraph's baseline a pill's text sits: half a dp,
 *  which keeps a dp of every line below the pill in it. */
export const MARKDOWN_CHIP_LIFT = 0.5
/**
 * Room for ink above and below the pill's text line, per unit of zoom, given
 * back in negative margin so the pill is no bigger. The pill's Text clips at
 * its own height (TextView.onDraw), and the font's ink runs past its line: the
 * ring of Å and Ů to 986 above the baseline, a comma below (ș ļ ķ) to 296 below
 * (glyf of the bundled TTF), past the 970 and 250 its line is built from;
 * Android's whole-pixel metrics take up to a pixel more (review of c3e62696,
 * clipped by up to 3.5 px). Sized for a system font size of 130%, which
 * grows the type and not this. Drawn only as whole pixels: see
 * markdownChipInkRoom.
 */
export const MARKDOWN_CHIP_INK_ROOM_TOP = 1.25
export const MARKDOWN_CHIP_INK_ROOM_BOTTOM = 2
/** What a whole number of pixels is nudged by. Divided by the density and
 *  multiplied back it can land a hair under itself (3 / 2.625 * 2.625 does,
 *  in doubles), and Fabric floors it; nudged, it floors to itself, and Yoga,
 *  which takes a height within 1e-4 px of a whole pixel as whole, still
 *  does. */
const PIXEL_NUDGE = 1e-5

/** A face's line, ascent and descent per em (hhea of the bundled TTF), and
 *  how far its ink reaches past them. */
export type MarkdownFaceMetrics = {
  ascent: number
  descent: number
  inkAbove: number
  inkBelow: number
}

/** Instrument Sans: 970 and 250; its ink reaches past them, the ring of Å to
 *  986 above and a comma below to 296 (glyf of the bundled TTF). */
export const INSTRUMENT_SANS_FACE: MarkdownFaceMetrics = {
  ascent: 0.97,
  descent: 0.25,
  inkAbove: 0.986,
  inkBelow: 0.296
}

/** JetBrains Mono: 1020 and 300, its ink inside them: Å to 994 above and the
 *  cedilla of Ģ to 240 below, over ASCII and Latin (the bundled TTF, measured
 *  2026-10-09). Every glyph is 600 of the em wide. */
export const JETBRAINS_MONO_FACE: MarkdownFaceMetrics = {
  ascent: 1.02,
  descent: 0.3,
  inkAbove: 0.994,
  inkBelow: 0.24
}

/**
 * The type one Markdown surface is set in. Every surface but the chat
 * transcript uses DEFAULT_MARKDOWN_TYPOGRAPHY, the sizes the constants above
 * have always carried; the transcript passes TRANSCRIPT_MARKDOWN_TYPOGRAPHY.
 */
export type MarkdownTypography = {
  /** Paragraphs, list items and quotes. */
  prose: { fontSize: number; lineHeight: number }
  /** h4 to h6, then h1, h2 and h3. */
  heading: { fontSize: number; lineHeight: number }
  headingLevel1: { fontSize: number; lineHeight: number }
  headingLevel2: { fontSize: number; lineHeight: number }
  headingLevel3: { fontSize: number; lineHeight: number }
  tableCell: { fontSize: number; lineHeight: number }
  /** An inline code pill, in a paragraph and in a table cell. `mono` sets it
   *  in the code face; otherwise it is the paragraph's own face. */
  chip: { fontSize: number; lineHeight: number; tableFontSize: number; tableLineHeight: number; mono: boolean }
  /** The list marker's size. */
  listMarkerSize: number
  /** The space between blocks: the height of the blank line between the
   *  blocks of a prose run, and the gap between the document's other blocks.
   *  A run stays one Text either way, so a selection crosses its blocks
   *  (mobile-markdown-prose-runs.ts); this sets only how tall the blank line
   *  is. Null: a whole prose line, and the default gap between blocks. */
  blockGap: number | null
  /** On Android, draw each prose run as one native TextView with hanging
   *  bullets and space between them (modules/orca-native-prose,
   *  native-prose-model.ts) instead of a React Native Text. Only the chat
   *  transcript sets it; iOS and the web keep the Text either way. */
  nativeProse?: boolean
}

export const DEFAULT_MARKDOWN_TYPOGRAPHY: MarkdownTypography = {
  prose: { fontSize: MARKDOWN_BASE_SIZE, lineHeight: MARKDOWN_BASE_SIZE + MARKDOWN_PROSE_LINE_GAP },
  heading: { fontSize: MARKDOWN_BASE_SIZE + 1, lineHeight: MARKDOWN_BASE_SIZE + 9 },
  headingLevel1: { fontSize: MARKDOWN_BASE_SIZE + 7, lineHeight: MARKDOWN_BASE_SIZE + 15 },
  headingLevel2: { fontSize: MARKDOWN_BASE_SIZE + 4, lineHeight: MARKDOWN_BASE_SIZE + 13 },
  headingLevel3: { fontSize: MARKDOWN_BASE_SIZE + 2, lineHeight: MARKDOWN_BASE_SIZE + 11 },
  // MARKDOWN_TABLE_CELL_FONT_SIZE and _LINE_HEIGHT, declared further down.
  tableCell: { fontSize: MARKDOWN_BASE_SIZE - 2, lineHeight: MARKDOWN_BASE_SIZE + MARKDOWN_PROSE_LINE_GAP },
  chip: {
    fontSize: MARKDOWN_CHIP_FONT_SIZE,
    lineHeight: MARKDOWN_CHIP_LINE_HEIGHT,
    tableFontSize: MARKDOWN_TABLE_CHIP_FONT_SIZE,
    tableLineHeight: MARKDOWN_TABLE_CHIP_LINE_HEIGHT,
    mono: false
  },
  listMarkerSize: MARKDOWN_BASE_SIZE - 1,
  blockGap: null
}

/**
 * The chat transcript, as the Claude app sets it (two screenshots on the same
 * phone, 2026-10-09): a body line every 22 dp (the app's 57.1 px at 2.57 px/dp
 * is 22.2), glyphs 9% taller than the 14 dp set this replaced (ink 37 px
 * against 34), about 7 dp between paragraphs and 4 between bullets, and inline
 * code in a monospace face on a pill about 16 dp tall. Instrument Sans at 15
 * is the face's own base size.
 *
 * A reply stays one selectable Text, so a hold's handles drag across its
 * paragraphs and bullets (the user's call, 2026-10-09). The 7 dp is the
 * blank line between blocks drawn 7 dp tall. On Android a run is one native
 * TextView (`nativeProse`, native-prose-model.ts), which also sets the bullets
 * in from the margin, hangs a wrapped bullet line under the bullet's words and
 * puts 4.5 dp between bullets, still one view a selection crosses. Elsewhere
 * the React Native Text keeps bullets at the line pitch and a wrapped bullet
 * line under its marker: a Text has no paragraph margin or spacing.
 *
 * The pill is JetBrains Mono at 12 on a 14 dp line: the face's own box is
 * 1.32 em, its ink 1.23 em (JETBRAINS_MONO_FACE), and markdownChipInkRoom
 * gives the rest back as padding. That pill is 16 dp tall, which a 22 dp line
 * holds with 6 dp to the pill below and its bottom a dp inside the line (the
 * rules in mobile-markdown-chip-clipping.test.ts, checked for this type in
 * mobile-markdown-transcript-typography.test.ts). A 13 sp pill needs a 23 dp
 * line by the same rules.
 */
export const TRANSCRIPT_MARKDOWN_TYPOGRAPHY: MarkdownTypography = {
  prose: { fontSize: 15, lineHeight: 22 },
  heading: { fontSize: 15.5, lineHeight: 22 },
  headingLevel1: { fontSize: 19, lineHeight: 26 },
  headingLevel2: { fontSize: 17, lineHeight: 24 },
  headingLevel3: { fontSize: 16, lineHeight: 23 },
  tableCell: { fontSize: 13, lineHeight: 22 },
  chip: { fontSize: 12, lineHeight: 14, tableFontSize: 11, tableLineHeight: 13, mono: true },
  listMarkerSize: 14,
  blockGap: 7,
  nativeProse: true
}

/**
 * A lead's Markdown prompt in a user bubble, in the transcript's size and
 * code face, its blocks a whole blank line apart as the bubble always drew
 * them (mobile-markdown-code-pill-bubble.test.ts, 2026-10-09).
 */
export const TRANSCRIPT_BUBBLE_MARKDOWN_TYPOGRAPHY: MarkdownTypography = {
  ...TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
  blockGap: null,
  // A bubble keeps the Text: it is a prompt, drawn as the bubble always drew it.
  nativeProse: false
}

/** The face a surface's pills are set in. */
export function markdownChipFace(typography: MarkdownTypography): MarkdownFaceMetrics {
  return typography.chip.mono ? JETBRAINS_MONO_FACE : INSTRUMENT_SANS_FACE
}
/** Pixels on top of that for Android's whole-pixel type: font metrics
 *  rounded (Paint.getFontMetricsInt), the odd pixel of a negative leading
 *  taken off the descent (CustomLineHeightSpan), and the font size rounded
 *  up to a pixel (TextAttributes.kt). One sufficed in the look test's model,
 *  which leaves the last out. */
const METRIC_PIXELS = 2

/**
 * The pill's room for ink at `zoom`, each side in dp that come to a whole
 * number of pixels at `density`, at least MARKDOWN_CHIP_INK_ROOM_* of them,
 * and more where the line is tight on the type as drawn: `sp` turns the
 * pill's sizes into dp at the system font size (android-font-scale.ts).
 * Android 14 scales the line height on the same curve as the type, which at
 * 150% to 200% leaves a line well short of the type's own 970 and 250 (at
 * 200%, 28.5 dp of line for 26 dp of type); a line that short is centred on
 * the type (CustomLineHeightSpan), so the ink runs past it by half the
 * shortfall each side, and the ring of Å and a comma below were clipped by
 * up to 5.5 px (review of 63858e9e). Sized for both the prose pill and the
 * table pill, which share the style.
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
  typography: MarkdownTypography = DEFAULT_MARKDOWN_TYPOGRAPHY
): { top: number; bottom: number } {
  let top = MARKDOWN_CHIP_INK_ROOM_TOP * zoom
  let bottom = MARKDOWN_CHIP_INK_ROOM_BOTTOM * zoom
  const { chip } = typography
  const face = markdownChipFace(typography)
  for (const [size, line] of [
    [chip.fontSize, chip.lineHeight],
    [chip.tableFontSize, chip.tableLineHeight]
  ] as const) {
    const type = sp(size * zoom)
    const short = Math.max(0, ((face.ascent + face.descent) * type - sp(line * zoom)) / 2)
    top = Math.max(top, (face.inkAbove - face.ascent) * type + short + METRIC_PIXELS / density)
    bottom = Math.max(bottom, (face.inkBelow - face.descent) * type + short + METRIC_PIXELS / density)
  }
  const whole = (dp: number) => (Math.ceil(dp * density - PIXEL_NUDGE) + PIXEL_NUDGE) / density
  return { top: whole(top), bottom: whole(bottom) }
}
/** A table cell's own type at no zoom; it follows the zoom as prose does
 *  (markdownZoomedLine). */
export const MARKDOWN_TABLE_CELL_FONT_SIZE = MARKDOWN_BASE_SIZE - 2
export const MARKDOWN_TABLE_CELL_LINE_HEIGHT = MARKDOWN_BASE_SIZE + MARKDOWN_PROSE_LINE_GAP
/** 2 dp more below a cell's text than above it, as since 2026-09-14. */
export const MARKDOWN_TABLE_CELL_PADDING_BOTTOM = 6
export const MARKDOWN_CHIP_PADDING_VERTICAL = 0
export const MARKDOWN_CHIP_PADDING_HORIZONTAL = 4
export const MARKDOWN_CHIP_BORDER_WIDTH = 1
export const MARKDOWN_CHIP_RADIUS = 7

/**
 * How far a pill is drawn below where Android lays it, so its text sits on
 * the paragraph's baseline, less MARKDOWN_CHIP_LIFT. Android hangs an inline
 * view's BOTTOM on the baseline (TextLayoutManager: top = baseline - height),
 * so the pill's own text rides above the words by its border, its padding,
 * and the part of its line below its baseline. 3.71 dp for a prose pill.
 */
export function markdownChipBaselineShift(
  fontSize: number,
  lineHeight: number,
  /** The pill's face: Instrument Sans, or JetBrains Mono in the transcript. */
  face: MarkdownFaceMetrics = INSTRUMENT_SANS_FACE
): number {
  const leading = lineHeight - (face.ascent + face.descent) * fontSize
  return (
    MARKDOWN_CHIP_BORDER_WIDTH +
    MARKDOWN_CHIP_PADDING_VERTICAL +
    face.descent * fontSize +
    leading / 2 -
    MARKDOWN_CHIP_LIFT
  )
}

export function markdownProseScale(
  size: number,
  textScale: number,
  /** The line at no zoom; the default type's is size + MARKDOWN_PROSE_LINE_GAP. */
  lineHeight = size + MARKDOWN_PROSE_LINE_GAP
): { fontSize: number; lineHeight: number } | null {
  // The pill's 1px borders do NOT scale — a hairline stays a hairline — so at
  // a small zoom they eat the gap the line height is there to provide. Adding
  // them back keeps the clear air between two wrapped pills constant at every
  // zoom instead of shrinking it away (markdownZoomedLine).
  return markdownZoomedLine(size, lineHeight, textScale)
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

export function markdownChipScale(
  textScale: number,
  typography: MarkdownTypography = DEFAULT_MARKDOWN_TYPOGRAPHY
): MarkdownChipScale | null {
  if (textScale === 1) {
    return null
  }
  const { chip } = typography
  return {
    factor: textScale,
    fontSize: chip.fontSize * textScale,
    lineHeight: chip.lineHeight * textScale,
    paddingVertical: MARKDOWN_CHIP_PADDING_VERTICAL * textScale,
    paddingHorizontal: MARKDOWN_CHIP_PADDING_HORIZONTAL * textScale,
    borderRadius: MARKDOWN_CHIP_RADIUS * textScale,
    baselineShift: markdownChipBaselineShift(chip.fontSize, chip.lineHeight, markdownChipFace(typography)) * textScale
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

/** What the pill actually paints, top to bottom, at a given zoom. */
export function markdownChipFootprint(
  textScale: number,
  typography: MarkdownTypography = DEFAULT_MARKDOWN_TYPOGRAPHY
): number {
  const chip = markdownChipScale(textScale, typography)
  const lineHeight = chip?.lineHeight ?? typography.chip.lineHeight
  const padding = chip?.paddingVertical ?? MARKDOWN_CHIP_PADDING_VERTICAL
  return lineHeight + 2 * padding + 2 * MARKDOWN_CHIP_BORDER_WIDTH
}
