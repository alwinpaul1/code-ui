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
// the line below is the prose line height. Pin the arithmetic so a future
// line-height or padding tweak cannot bring the overlap back.
//
// Corrected 2026-09-26: this used to add the baseline shift to the pill's
// height. The shift is a transform on EVERY pill, so two pills on consecutive
// lines move together and the gap between them is the line height less one
// pill's height. The shift's own risk is the other direction: it must not push
// a pill out of the bottom of its own line, into the words below.
describe('a wrapped inline code chip does not collide with the pill on the next line', () => {
  const MIN_GAP = 2
  /** Instrument Sans ascent and descent per em (hhea of the bundled TTF). */
  const ASCENT = 0.97
  const DESCENT = 0.25
  it.each(['dark', 'light'] as const)(
    'keeps a full line-gap above and below each pill in %s',
    (scheme) => {
      type Block = { fontSize: number; lineHeight: number }
      const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as {
        paragraph: Block
        tableCell: Block
        heading: Block
        headingLevel1: Block
        headingLevel2: Block
        headingLevel3: Block
        listText: Block
        quoteText: Block
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
      // tableCell joins the list on 2026-09-15. A table's Branch column stacked
      // two pills of one split path and they collided and clipped (device
      // screenshot) — the cell's line height was BASE + 4 while a pill paints
      // BASE + 7. The invariant was right; it just was not asked about every
      // block a pill can land in, which is the whole lesson.
      // EVERY block renderInline can put a pill in, not the three that had been
      // reported so far.
      for (const [name, block] of Object.entries({
        paragraph: styles.paragraph,
        listText: styles.listText,
        quoteText: styles.quoteText,
        tableCell: styles.tableCell,
        heading: styles.heading,
        headingLevel1: { ...styles.heading, ...styles.headingLevel1 },
        headingLevel2: { ...styles.heading, ...styles.headingLevel2 },
        headingLevel3: { ...styles.heading, ...styles.headingLevel3 }
      })) {
        expect(block.lineHeight - chipHeight, `${name}: pill over pill`).toBeGreaterThanOrEqual(MIN_GAP)
        // A line holding a pill takes the pill's height as its ascent; the
        // line height's leftover is split above and below. The pill's bottom,
        // `shift` under the baseline, must stay inside that.
        const ascent = Math.max(ASCENT * block.fontSize, chipHeight)
        const descent = DESCENT * block.fontSize
        const belowBaseline = descent + (block.lineHeight - ascent - descent) / 2
        expect(shift, `${name}: pill bottom inside its line`).toBeLessThanOrEqual(belowBaseline)
      }
    }
  )
})

// 2026-09-14, from the phone: `chapters/_archive_pre_outline_2026-09-08/` split
// into two pills that landed side by side, and their rounded borders overlapped
// into one broken-looking pill. That was pinned here as a 3 dp margin on the
// pill; on this React Native an inline View's margins do nothing (Fabric lays
// it at its placeholder's origin with its border-box size), so the margin never
// kept anything apart. Since 2026-09-26 two pieces of one span never share a
// line: a span is cut to the room its line has left and then whole lines, and
// re-cut from the phone's layout (mobile-markdown-code-pill-flow.test.ts pins
// no two pieces on one line).
