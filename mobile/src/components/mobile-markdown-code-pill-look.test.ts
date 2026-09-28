import { describe, expect, it, vi } from 'vitest'

// makeMarkdownStyles calls StyleSheet.create and reads the density; the real
// react-native entry is Flow-typed and this runner cannot parse it.
const screen = vi.hoisted(() => ({ density: 3, fontScale: 1, api: 34 }))
vi.mock('react-native', () => ({
  PixelRatio: { get: () => screen.density, getFontScale: () => screen.fontScale },
  Platform: {
    OS: 'android',
    get Version() {
      return screen.api
    }
  },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import type { Theme } from '../theme/theme-context'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { androidSpScale } from './android-font-scale'
import { markdownChipGeometry, markdownChipInkRoom, markdownZoomedLine } from './mobile-markdown-prose-scale'
import { makeMarkdownStyles } from './mobile-markdown-styles'

function themeFor(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    preference: scheme,
    setPreference: () => undefined,
    colors: scheme === 'dark' ? darkColors : lightColors,
    syntax: syntaxPaletteForScheme(scheme),
    space,
    radius,
    type,
    fonts: fontFamily,
    isDark: scheme === 'dark'
  }
}

type TextStyle = {
  fontFamily: string
  fontSize: number
  lineHeight: number
  color?: string
  paddingTop?: number
  paddingBottom?: number
  marginTop?: number
  marginBottom?: number
}
type Box = {
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
  paddingHorizontal?: number
  paddingVertical?: number
  transform?: { translateY?: number }[]
}
type Styles = {
  paragraph: TextStyle
  tableCell: TextStyle
  heading: TextStyle
  headingLevel1: TextStyle
  headingLevel2: TextStyle
  headingLevel3: TextStyle
  inlineCodeChip: Box
  inlineCodeChipText: TextStyle
  inlineCodeChipTextTable: TextStyle
}

/** Instrument Sans ascent and descent, 970 and 250 per 1000 em (hhea of the
 *  bundled TTF, which also sets USE_TYPO_METRICS with the same values). */
const ASCENT = 0.97
const DESCENT = 0.25

const f32 = Math.fround
/** Within Yoga's 1e-4 of a whole pixel (Comparison.h). */
const whole = (px: number) => Math.abs(px - Math.round(px)) < 1e-4

/**
 * How many pixels a pill's Text draws above and below its baseline, the worst
 * over where its top falls within a pixel, as RN 0.86 Fabric on Android lays
 * it out and draws it:
 * - the line: Paint.getFontMetricsInt rounds the font's 970 and 250 to whole
 *   pixels, and CustomLineHeightSpan shares out the line height, the odd
 *   pixel of a negative leading off the descent;
 * - its padding: floor(dp * density) in float (FabricMountingManager.cpp);
 * - its frame: Yoga puts a text node's top on the pixel below it and, when
 *   its height is not a whole pixel, its bottom on the pixel after
 *   (PixelGrid.cpp), so the frame can come out taller than the text and its
 *   padding;
 * - the clip: TextView.onDraw clips at the view's bottom only when the
 *   layout fills the content box exactly, and at the content box's bottom
 *   otherwise; at the top, not scrolled, it never clips.
 */
function drawnRoom(fontPx: number, lineHeightPx: number, room: { top: number; bottom: number }, density: number) {
  const skRound = (x: number) => Math.floor(x + 0.5)
  const ascent = skRound(ASCENT * fontPx)
  const descent = skRound(DESCENT * fontPx)
  const leading = Math.ceil(lineHeightPx) - (ascent + descent)
  const lineAbove = ascent + Math.ceil(leading / 2)
  const lineBelow = descent + Math.floor(leading / 2)
  const layout = lineAbove + lineBelow
  const inset = (dp: number) => Math.floor(f32(f32(dp) * f32(density)))
  const [padTop, padBottom] = [inset(room.top), inset(room.bottom)]
  const node = layout + room.top * density + room.bottom * density
  let below = Infinity
  for (let step = 0; step < 40; step += 1) {
    const top = 100 + step / 40
    const bottom = top + node
    const onGrid = (px: number, up: boolean) => (whole(px) ? Math.round(px) : up ? Math.ceil(px) : Math.floor(px))
    const frame = onGrid(bottom, !whole(node)) - onGrid(top, false)
    const content = frame - padTop - padBottom
    below = Math.min(below, lineBelow + (content === layout ? padBottom : content - layout))
  }
  return { above: lineAbove + padTop, below }
}

// 2026-09-26, two screenshots: the Claude app draws inline code in the
// paragraph's own face at about its size, blue on a faint pill with a little
// padding, on the paragraph's baseline. Code UI drew JetBrains Mono, wider,
// with more padding, the pill riding above the words beside it.
describe.each(['light', 'dark'] as const)('an inline code pill in %s', (scheme) => {
  const colors = scheme === 'dark' ? darkColors : lightColors
  const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as Styles
  const chip = styles.inlineCodeChip
  const label = styles.inlineCodeChipText

  // 2026-09-28, a screenshot of the Claude Android app: its pill's text is
  // 0.85 of its words (x-height 17 px to 20, ascender 25 to 29). Code UI's
  // words wrap where its narrower face wraps, and at 0.9 of them its pill's
  // text is the Claude pill's own size: 6.4 dp of x-height in both.
  it("is set in the paragraph's own face at 0.9 of its size, and a cell's pill at 0.9 of the cell's", () => {
    expect(label.fontFamily).toBe(styles.paragraph.fontFamily)
    expect(label.fontSize / styles.paragraph.fontSize).toBeCloseTo(0.9, 6)
    // A table cell is smaller type; its pill follows the cell, not the paragraph.
    expect(styles.inlineCodeChipTextTable.fontFamily ?? label.fontFamily).toBe(styles.tableCell.fontFamily)
    expect(styles.inlineCodeChipTextTable.fontSize / styles.tableCell.fontSize).toBeCloseTo(0.9, 6)
  })

  it('keeps the blue text on a faint themed pill', () => {
    expect(label.color).toBe(colors.codeSpanText)
    expect(chip.backgroundColor).toBe(colors.codeSpanBg)
    expect(chip.borderColor).toBe(colors.codeSpanBorder)
    expect(chip.borderRadius).toBeGreaterThan(0)
  })

  it('has tight padding and a line no taller than the text needs or the paragraph gives', () => {
    expect(chip.paddingHorizontal ?? 0).toBeLessThanOrEqual(4)
    expect(chip.paddingVertical ?? 0).toBeLessThanOrEqual(1)
    // The glyphs' own ascent plus descent, rounded to the dp.
    expect(label.lineHeight).toBeLessThanOrEqual(Math.ceil((ASCENT + DESCENT) * label.fontSize))
    expect(label.lineHeight).toBeLessThanOrEqual(styles.paragraph.lineHeight)
    // The Claude app's pill is about 1.35 times the paragraph's type size.
    const height = label.lineHeight + 2 * (chip.paddingVertical ?? 0) + 2 * (chip.borderWidth ?? 0)
    expect(height).toBeLessThanOrEqual(1.35 * styles.paragraph.fontSize)
  })

  // Review of f8c968a1: a 16 dp line clipped g and j by up to 0.9 px. Review
  // of c3e62696: still g and j by up to 0.32 px at zoom 0.8 to 0.9, the ring of
  // Å and Ů (above the 970 ascent) by up to 1.41 px, and a comma below (ș ļ ķ)
  // by up to 3.5 px. Android rounds font metrics to whole pixels
  // (Paint.getFontMetricsInt), CustomLineHeightSpan (RN 0.86) takes the odd
  // pixel of a negative leading off the descent, and TextView.onDraw clips at
  // the view's height, padding included. The pill's Text carries padding
  // above and below, taken back by as much negative margin. Review of
  // 4c2732f4: that padding below never drew at 2.625, 2.75, 3 or 3.5, and the
  // comma below was still clipped by 1.9 to 4.2 px (see drawnRoom).
  // Review of 63858e9e: Android 14 scales a pill's line height as sp on its
  // curve (TextAttributes.kt), which at 150% to 200% leaves the line much
  // tighter on the type than linear scaling does (at 200%, 28.5 dp of line
  // for 26 dp of type), and the ring of Å and a comma below were clipped by
  // up to 5.5 px. The room for ink is sized from the type and line as drawn.
  it.each([2.625, 2.75, 2.8125, 3, 3.5])("keeps every glyph of the font whole, at every zoom and system font size, at density %s", (density) => {
    screen.density = density
    const clipped: string[] = []
    for (const [api, fontScale] of [
      [33, 1],
      [33, 1.15],
      [33, 1.3],
      [33, 1.5],
      [33, 1.7],
      [33, 2],
      [34, 1.15],
      [34, 1.3],
      [34, 1.5],
      [34, 1.8],
      [34, 2]
    ] as const) {
      screen.fontScale = fontScale
      screen.api = api
      const sp = androidSpScale(fontScale, api)
      const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as Styles
      // Every line a pill is set in (its text from its words' since
      // 2026-09-28), and the pill each draws: its type and line from
      // markdownChipGeometry and its room for ink from them, as
      // MobileMarkdownCodeChip draws it (review of 2ebd5ce6: this read the
      // stylesheet's room, which the chip no longer uses).
      const lines = [
        ['prose', styles.paragraph],
        ['table', styles.tableCell],
        ['h1', { ...styles.heading, ...styles.headingLevel1 }],
        ['h2', { ...styles.heading, ...styles.headingLevel2 }],
        ['h3', { ...styles.heading, ...styles.headingLevel3 }],
        ['h4', styles.heading]
      ] as const
      for (const [name, words] of lines) {
        for (const zoom of [0.8, 0.9, 1, 1.25, 1.5, 1.8]) {
          // The zoom scales the words (markdownZoomedLine), and the system
          // font size turns sp into dp; the room for ink is dp.
          const line = markdownZoomedLine(words.fontSize, words.lineHeight, zoom) ?? words
          const text = markdownChipGeometry(line.fontSize, sp, line.lineHeight)
          const room = markdownChipInkRoom(density, 1, sp.toDp, [[text.fontSize, text.lineHeight]])
          const px = sp.toDp(text.fontSize) * density
          const { above, below } = drawnRoom(px, sp.toDp(text.lineHeight) * density, room, density)
          // The font's ink: 986 above the baseline (the ring of Å), 296 below
          // (a comma below), per 1000 em (glyf of the bundled TTF).
          const at = `${name} zoom ${zoom} font ${fontScale} on API ${api}`
          if (0.986 * px > above) {
            clipped.push(`${at}: top by ${(0.986 * px - above).toFixed(2)} px`)
          }
          if (0.296 * px > below) {
            clipped.push(`${at}: bottom by ${(0.296 * px - below).toFixed(2)} px`)
          }
        }
      }
    }
    screen.fontScale = 1
    expect(clipped).toEqual([])
  })

  it('takes the room for ink back in margin, so the pill is no bigger for it', () => {
    for (const text of [label, { ...label, ...styles.inlineCodeChipTextTable }]) {
      expect(text.paddingTop).toBeGreaterThan(0)
      expect(text.paddingBottom).toBeGreaterThan(0)
      expect(text.marginTop).toBe(-(text.paddingTop ?? 0))
      expect(text.marginBottom).toBe(-(text.paddingBottom ?? 0))
    }
  })

  it("sits the code on the paragraph's baseline, from a frame no taller than the words' ascent", () => {
    // RN hangs an inline view's frame from the baseline (top = baseline -
    // height). The frame is the words' ascent less their descent, and the
    // pill is drawn `shift` from its top: the pill's own baseline, that far
    // down the frame and its text's line into the pill, is the words'.
    const words = styles.paragraph.fontSize
    const geometry = markdownChipGeometry(words)
    expect(geometry.frame).toBeLessThan(ASCENT * words)
    const pillBaseline =
      -geometry.frame +
      geometry.shift +
      (chip.borderWidth ?? 0) +
      (chip.paddingVertical ?? 0) +
      ASCENT * label.fontSize +
      (label.lineHeight - (ASCENT + DESCENT) * label.fontSize) / 2
    expect(pillBaseline).toBeCloseTo(0, 6)
  })
})
