import { describe, expect, it, vi } from 'vitest'

// makeMarkdownStyles calls StyleSheet.create; the real react-native entry is
// Flow-typed and this runner cannot parse it.
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import type { Theme } from '../theme/theme-context'
import {
  MARKDOWN_INLINE_CHIP_BASELINE_SHIFT,
  makeMarkdownStyles
} from './mobile-markdown-styles'

function themeFor(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    preference: scheme,
    setPreference: () => undefined,
    colors: scheme === 'dark' ? darkColors : lightColors,
    space,
    radius,
    type,
    fonts: fontFamily,
    isDark: scheme === 'dark'
  }
}

type Box = {
  paddingTop?: number
  paddingBottom?: number
  paddingVertical?: number
  transform?: { translateY?: number }[]
}

describe('an inline code chip inside a table', () => {
  it.each(['dark', 'light'] as const)('is not sliced off by the table clip in %s', (scheme) => {
    // 2026-09-14, from the phone: a `54;1H` chip in a table row lost its top
    // and bottom. The chip is PAINTED lower than it is laid out so it sits
    // level with the text around it, and the table needs overflow:hidden for
    // its rounded corners — so the cell has to leave room for that shift.
    const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as {
      tableCell: Box
      inlineCodeChip: Box
    }
    const shift = styles.inlineCodeChip.transform?.find(
      (entry) => entry.translateY !== undefined
    )?.translateY
    expect(shift).toBe(MARKDOWN_INLINE_CHIP_BASELINE_SHIFT)
    const cell = styles.tableCell
    // A single paddingVertical cannot express this: the room is only needed below.
    expect(cell.paddingVertical).toBeUndefined()
    expect((cell.paddingBottom ?? 0) - (cell.paddingTop ?? 0)).toBeGreaterThanOrEqual(
      MARKDOWN_INLINE_CHIP_BASELINE_SHIFT
    )
  })
})

// 2026-09-14, from the phone: a long inline code span (`feat/mobile-charging-
// ops-glanceable-and-gated`) split into two pills that wrapped onto consecutive
// lines, and the pills MERGED — the lower one's border cut across the upper
// one's descenders, so the text read as cropped. An inline View is hung from
// the text baseline and its vertical margins are ignored by Android's text
// layout, so the ONLY thing that separates one wrapped pill from the pill on
// the line below is the prose line height. If a pill's painted footprint
// (its box plus the downward baseline shift) is taller than the line, the two
// lines' pills overlap. Pin the arithmetic so a future line-height or padding
// tweak cannot bring the overlap back.
describe('a wrapped inline code chip does not collide with the pill on the next line', () => {
  const MIN_GAP = 2
  it.each(['dark', 'light'] as const)(
    'keeps a full line-gap above and below each pill in %s',
    (scheme) => {
      const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as {
        paragraph: { lineHeight: number }
        tableCell: { lineHeight: number }
        heading: { lineHeight: number }
        headingLevel1: { lineHeight: number }
        headingLevel2: { lineHeight: number }
        headingLevel3: { lineHeight: number }
        listText: { lineHeight: number }
        quoteText: { lineHeight: number }
        inlineCodeChip: { paddingVertical?: number; borderWidth?: number } & Box
        inlineCodeChipText: { lineHeight: number }
      }
      const chip = styles.inlineCodeChip
      const shift =
        chip.transform?.find((entry) => entry.translateY !== undefined)?.translateY ?? 0
      const chipHeight =
        styles.inlineCodeChipText.lineHeight +
        2 * (chip.paddingVertical ?? 0) +
        2 * (chip.borderWidth ?? 0)
      const footprint = shift + chipHeight
      // Every prose block a chip can wrap inside must clear the pill's footprint
      // with room to spare, or two wrapped pills touch.
      // tableCell joins the list on 2026-09-15. A table's Branch column stacked
      // two pills of one split path and they collided and clipped (device
      // screenshot) — the cell's line height was BASE + 4 while a pill paints
      // BASE + 7. The invariant was right; it just was not asked about every
      // block a pill can land in, which is the whole lesson.
      // EVERY block renderInline can put a pill in, not the three that had been
      // reported so far. The headings already cleared it — h4 exactly — and are
      // here so they cannot drift below it unnoticed.
      for (const block of [
        styles.paragraph,
        styles.listText,
        styles.quoteText,
        styles.tableCell,
        styles.heading,
        styles.headingLevel1,
        styles.headingLevel2,
        styles.headingLevel3
      ]) {
        expect(block.lineHeight).toBeGreaterThanOrEqual(footprint + MIN_GAP)
      }
    }
  )
})

// 2026-09-14, from the phone: `chapters/_archive_pre_outline_2026-09-08/` split
// into two pills that landed side by side, and their rounded borders overlapped
// into one broken-looking pill. Adjacent pills need a visible gap.
describe('two inline code pills side by side', () => {
  it.each(['dark', 'light'] as const)('keep a clear gap between them in %s', (scheme) => {
    const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as {
      inlineCodeChip: { marginHorizontal?: number; borderRadius?: number }
    }
    const chip = styles.inlineCodeChip
    // Each pill's own margin on both sides adds up to the gap between two; the
    // rounded corners need at least that much or they touch.
    const gap = 2 * (chip.marginHorizontal ?? 0)
    expect(gap).toBeGreaterThanOrEqual(6)
  })
})
