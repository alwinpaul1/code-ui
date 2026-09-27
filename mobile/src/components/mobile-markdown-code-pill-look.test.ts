import { describe, expect, it, vi } from 'vitest'

// makeMarkdownStyles calls StyleSheet.create; the real react-native entry is
// Flow-typed and this runner cannot parse it.
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import type { Theme } from '../theme/theme-context'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
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
  inlineCodeChip: Box
  inlineCodeChipText: TextStyle
  inlineCodeChipTextTable: TextStyle
}

/** Instrument Sans ascent and descent, 970 and 250 per 1000 em (hhea of the
 *  bundled TTF, which also sets USE_TYPO_METRICS with the same values). */
const ASCENT = 0.97
const DESCENT = 0.25

// 2026-09-26, two screenshots: the Claude app draws inline code in the
// paragraph's own face at about its size, blue on a faint pill with a little
// padding, on the paragraph's baseline. Code UI drew JetBrains Mono, wider,
// with more padding, the pill riding above the words beside it.
describe.each(['light', 'dark'] as const)('an inline code pill in %s', (scheme) => {
  const colors = scheme === 'dark' ? darkColors : lightColors
  const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as Styles
  const chip = styles.inlineCodeChip
  const label = styles.inlineCodeChipText

  it("is set in the paragraph's own face, the same size or one step smaller", () => {
    expect(label.fontFamily).toBe(styles.paragraph.fontFamily)
    expect(styles.paragraph.fontSize - label.fontSize).toBeGreaterThanOrEqual(0)
    expect(styles.paragraph.fontSize - label.fontSize).toBeLessThanOrEqual(1)
    // A table cell is smaller type; its pill follows the cell, not the paragraph.
    expect(styles.inlineCodeChipTextTable.fontFamily ?? label.fontFamily).toBe(styles.tableCell.fontFamily)
    expect(styles.tableCell.fontSize - styles.inlineCodeChipTextTable.fontSize).toBeGreaterThanOrEqual(0)
    expect(styles.tableCell.fontSize - styles.inlineCodeChipTextTable.fontSize).toBeLessThanOrEqual(1)
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
  // above and below, taken back by as much negative margin, so it clips out
  // at the font's ink and the pill is no bigger.
  it.each([2.625, 2.75, 2.8125, 3, 3.5])("keeps every glyph of the font whole, at every zoom and system font size, at density %s", (density) => {
    const skRound = (x: number) => Math.floor(x + 0.5)
    const clipped: string[] = []
    for (const [name, text] of [
      ['prose', label],
      ['table', { ...label, ...styles.inlineCodeChipTextTable }]
    ] as const) {
      for (const zoom of [0.8, 0.9, 1, 1.25, 1.5, 1.8]) {
        for (const fontScale of [1, 1.15, 1.3]) {
          // The zoom scales the pill's type and its room for ink alike
          // (MobileMarkdownCodeChip); the system font size scales type only.
          const px = text.fontSize * zoom * fontScale * density
          const ascent = skRound(ASCENT * px)
          const descent = skRound(DESCENT * px)
          const leading = Math.ceil(text.lineHeight * zoom * fontScale * density) - (ascent + descent)
          const above = ascent + Math.ceil(leading / 2) + Math.round((text.paddingTop ?? 0) * zoom * density)
          const below = descent + Math.floor(leading / 2) + Math.round((text.paddingBottom ?? 0) * zoom * density)
          // The font's ink: 986 above the baseline (the ring of Å), 296 below
          // (a comma below), per 1000 em (glyf of the bundled TTF).
          if (0.986 * px > above) {
            clipped.push(`${name} zoom ${zoom} font ${fontScale}: top by ${(0.986 * px - above).toFixed(2)} px`)
          }
          if (0.296 * px > below) {
            clipped.push(`${name} zoom ${zoom} font ${fontScale}: bottom by ${(0.296 * px - below).toFixed(2)} px`)
          }
        }
      }
    }
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

  it("sits the code on the paragraph's baseline, or half a dp above it, never below", () => {
    // Android hangs an inline view's bottom on the baseline, so the pill's
    // own text sits above it by the pill's border, padding, and the part of
    // its line below its baseline. The pill is moved down by that, less half
    // a dp that keeps a dp of the line below every pill (mobile-markdown-
    // prose-scale.ts, and the collision test).
    const shift = chip.transform?.find((entry) => entry.translateY !== undefined)?.translateY ?? 0
    const onBaseline =
      (chip.borderWidth ?? 0) +
      (chip.paddingVertical ?? 0) +
      DESCENT * label.fontSize +
      (label.lineHeight - (ASCENT + DESCENT) * label.fontSize) / 2
    expect(shift).toBeLessThanOrEqual(onBaseline)
    expect(onBaseline - shift).toBeLessThanOrEqual(0.5)
  })
})
