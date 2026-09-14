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
      for (const block of [styles.paragraph, styles.listText, styles.quoteText]) {
        expect(block.lineHeight).toBeGreaterThanOrEqual(footprint + MIN_GAP)
      }
    }
  )
})
