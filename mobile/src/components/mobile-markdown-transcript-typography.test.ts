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
import {
  DEFAULT_MARKDOWN_TYPOGRAPHY,
  INSTRUMENT_SANS_FACE,
  JETBRAINS_MONO_FACE,
  MARKDOWN_CHIP_BORDER_WIDTH,
  MARKDOWN_CHIP_RADIUS,
  TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
  markdownChipBaselineShift,
  markdownChipFootprint,
  markdownChipScale,
  markdownProseScale,
  markdownZoomedLine
} from './mobile-markdown-prose-scale'
import { codePillWidth } from './mobile-markdown-code-chip-split'

// 2026-10-09, the user, with screenshots of the Claude app's transcript beside
// ours: "we can't see most of the content". Measured on the same phone
// (1080 px wide, 2.8125 px per dp): the Claude app at its "Small" transcript
// size draws a body line every 21.4 dp, about 7 dp between paragraphs and 4
// between bullets, its words 94% as wide as ours, and its inline code in a
// monospace face on a pill about 16 dp tall. Ours drew 15 sp on a 25 dp line
// with a whole blank line between paragraphs. The set was 14 on 21 first; a
// second pass the same day (ink 37 px against 34, line pitch 57.1 px against
// 55.3) moved it to 15 on 22.

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

type Line = { fontSize: number; lineHeight: number }
type Styles = Record<string, Record<string, unknown>>

const SCHEMES = ['light', 'dark'] as const

// 2026-10-11: the Claude app's own type scale for a Claude Code session, read
// from its code (com.anthropic.claude 1.261009.20, docs/claude-app-typography.md):
// body 17 on 1.5 em, headings 28, 24 and 20 on 1.3 em, 8 between blocks, code
// 15. That is its Medium transcript size, the default; the 15 on 22 above was
// measured off screenshots of its Small.
describe('the chat transcript at the Claude app’s Medium size', () => {
  it.each(SCHEMES)('sets prose at 17 on a 25.5 dp line in %s', (scheme) => {
    const styles = makeMarkdownStyles(themeFor(scheme), TRANSCRIPT_MARKDOWN_TYPOGRAPHY) as unknown as Styles
    for (const name of ['paragraph', 'quoteText', 'listText']) {
      expect(styles[name]!.fontSize, name).toBe(17)
      expect(styles[name]!.lineHeight, name).toBe(25.5)
    }
    // Between one block and the next, as between the Claude app's paragraphs.
    expect(styles.root!.gap).toBe(8)
  })

  it.each(SCHEMES)('steps the headings down from 28 to 20, every one above the 17 dp prose, in %s', (scheme) => {
    const styles = makeMarkdownStyles(themeFor(scheme), TRANSCRIPT_MARKDOWN_TYPOGRAPHY) as unknown as Styles
    expect(styles.heading).toMatchObject({ fontSize: 20, lineHeight: 26 })
    expect(styles.headingLevel1).toMatchObject({ fontSize: 28, lineHeight: 36.4 })
    expect(styles.headingLevel2).toMatchObject({ fontSize: 24, lineHeight: 31.2 })
    expect(styles.headingLevel3).toMatchObject({ fontSize: 20, lineHeight: 26 })
    expect(styles.listMarkerInline).toMatchObject({ fontSize: 16 })
    const sizes = ['headingLevel1', 'headingLevel2', 'headingLevel3', 'heading'].map(
      (name) => styles[name]!.fontSize as number
    )
    expect(sizes).toEqual([...sizes].sort((x, y) => y - x))
    expect(Math.min(...sizes)).toBeGreaterThan(17)
  })

  it.each(SCHEMES)('draws inline code in JetBrains Mono at the app’s 15, in %s', (scheme) => {
    const styles = makeMarkdownStyles(themeFor(scheme), TRANSCRIPT_MARKDOWN_TYPOGRAPHY) as unknown as Styles
    expect(styles.inlineCodeChipText!.fontFamily).toBe(fontFamily.mono)
    expect(styles.inlineCodeChipText!.fontSize).toBe(15)
    expect(styles.inlineCodeChipTextTable!.fontFamily).toBe(fontFamily.mono)
    // A span with a newline in it stays a nested Text; it is code too.
    expect(styles.inlineCode!.fontFamily).toBe(fontFamily.mono)
    // Its text sits on the paragraph's baseline, in the mono face's metrics,
    // with the transcript's 0.5 dp hairline.
    const shift = (styles.inlineCodeChip!.transform as { translateY: number }[])[0]!.translateY
    expect(shift).toBeCloseTo(markdownChipBaselineShift(15, 17.5, JETBRAINS_MONO_FACE, 0.5), 6)
  })

  it.each(SCHEMES)('keeps every colour on the theme tokens in %s', (scheme) => {
    const theme = themeFor(scheme)
    const before = makeMarkdownStyles(theme) as unknown as Styles
    const after = makeMarkdownStyles(theme, TRANSCRIPT_MARKDOWN_TYPOGRAPHY) as unknown as Styles
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    for (const [name, style] of Object.entries(before)) {
      for (const key of ['color', 'backgroundColor', 'borderColor', 'borderLeftColor']) {
        expect(after[name]![key], `${scheme} ${name}.${key}`).toBe(style[key])
      }
    }
  })
})

describe('every other Markdown surface', () => {
  it.each(SCHEMES)('keeps the sizes it had before the transcript changed, in %s', (scheme) => {
    // The file reader, task comments, release notes and the tool sheet keep
    // their type: "others stay the same".
    const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as Styles
    expect(styles.paragraph).toMatchObject({ fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 25 })
    expect(styles.quoteText).toMatchObject({ fontSize: 15, lineHeight: 25 })
    expect(styles.heading).toMatchObject({ fontSize: 16, lineHeight: 24 })
    expect(styles.headingLevel1).toMatchObject({ fontSize: 22, lineHeight: 30 })
    expect(styles.headingLevel2).toMatchObject({ fontSize: 19, lineHeight: 28 })
    expect(styles.headingLevel3).toMatchObject({ fontSize: 17, lineHeight: 26 })
    expect(styles.inlineCodeChipText).toMatchObject({ fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 16.5 })
    expect(styles.inlineCodeChipTextTable).toMatchObject({ fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 15.5 })
    expect(styles.inlineCode).toMatchObject({ fontFamily: fontFamily.regular, fontSize: 14 })
    expect(styles.tableCell).toMatchObject({ fontSize: 13, lineHeight: 25 })
    expect(styles.codeText).toMatchObject({ fontFamily: fontFamily.mono, fontSize: 13, lineHeight: 20 })
    expect(styles.listMarkerInline).toMatchObject({ fontSize: 14 })
    expect(styles.root!.gap).toBe(space.sm + 2)
    expect(DEFAULT_MARKDOWN_TYPOGRAPHY.blockGap).toBeNull()
  })

  it('keeps the default zoom arithmetic as it was', () => {
    expect(markdownProseScale(15, 2)).toEqual({ fontSize: 30, lineHeight: 52 })
    expect(markdownChipScale(1)).toBeNull()
    expect(markdownChipFootprint(1)).toBe(18.5)
    // Literals in DEFAULT_MARKDOWN_TYPOGRAPHY, which is declared above the constants.
    expect(DEFAULT_MARKDOWN_TYPOGRAPHY.chip.borderWidth).toBe(MARKDOWN_CHIP_BORDER_WIDTH)
    expect(DEFAULT_MARKDOWN_TYPOGRAPHY.chip.radius).toBe(MARKDOWN_CHIP_RADIUS)
    expect(DEFAULT_MARKDOWN_TYPOGRAPHY.codeBlock).toEqual({ radius: radius.md, padding: space.md })
  })
})

/** Prose ascent and descent per em: Instrument Sans, the transcript's face. */
function lineBottom(fontSize: number, lineHeight: number, pill: number): number {
  const ascent = Math.max(INSTRUMENT_SANS_FACE.ascent * fontSize, pill)
  const descent = INSTRUMENT_SANS_FACE.descent * fontSize
  return descent + (lineHeight - ascent - descent) / 2
}

// The pinch zoom runs from 0.8 to 1.8, and a thought is drawn at 0.93 of it.
const ZOOMS = [0.8 * 0.93, 0.8, 0.9, 0.93, 1, 1.1, 1.25, 1.4, 1.6, 1.8]

describe('a transcript pill at every zoom', () => {
  // The same two rules mobile-markdown-chip-clipping.test.ts pins for the
  // default type: a wrapped pill clears the pill on the line below, and its
  // bottom, painted under the baseline, stays inside its own line.
  it.each(SCHEMES)('clears the pill below and stays inside its line in %s', (scheme) => {
    const typo = TRANSCRIPT_MARKDOWN_TYPOGRAPHY
    const styles = makeMarkdownStyles(themeFor(scheme), typo) as unknown as Record<string, Line>
    const blocks: [string, Line, boolean][] = [
      ['paragraph', styles.paragraph!, false],
      ['quoteText', styles.quoteText!, false],
      ['listText', styles.listText!, false],
      ['tableCell', styles.tableCell!, true],
      ['heading', styles.heading!, false],
      ['headingLevel1', { ...styles.heading!, ...styles.headingLevel1! }, false],
      ['headingLevel2', { ...styles.heading!, ...styles.headingLevel2! }, false],
      ['headingLevel3', { ...styles.heading!, ...styles.headingLevel3! }, false]
    ]
    for (const zoom of ZOOMS) {
      const chip = markdownChipScale(zoom, typo)
      const shift =
        chip?.baselineShift ??
        markdownChipBaselineShift(typo.chip.fontSize, typo.chip.lineHeight, JETBRAINS_MONO_FACE, typo.chip.borderWidth)
      for (const [name, block, table] of blocks) {
        const line = markdownZoomedLine(block.fontSize, block.lineHeight, zoom) ?? block
        const pillLine = (table ? typo.chip.tableLineHeight : typo.chip.lineHeight) * (chip?.factor ?? 1)
        const pill = pillLine + 2 * typo.chip.borderWidth
        expect(line.lineHeight - pill, `${name} at ${zoom}: pill over pill`).toBeGreaterThanOrEqual(2)
        expect(lineBottom(line.fontSize, line.lineHeight, pill) - shift, `${name} at ${zoom}: inside its line`).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('a transcript pill’s width', () => {
  it('is priced in JetBrains Mono’s advances, 0.6 em a character', () => {
    // Priced in Instrument Sans, four `i` are 11.5 dp at 12 sp; drawn in the
    // code face they are 28.8, and the pill would run past its line.
    expect(codePillWidth('iiii', { fontSize: 12, insets: 0, mono: true })).toBeCloseTo(28.8, 6)
    expect(codePillWidth('iiii', { fontSize: 12, insets: 0 })).toBeCloseTo(11.52, 6)
    // A wide fallback glyph is a full em in either face.
    expect(codePillWidth('漢', { fontSize: 12, insets: 0, mono: true })).toBeCloseTo(12, 6)
  })

  it('handles an empty piece', () => {
    expect(codePillWidth('', { fontSize: 12, insets: 2, mono: true })).toBe(2)
  })
})
