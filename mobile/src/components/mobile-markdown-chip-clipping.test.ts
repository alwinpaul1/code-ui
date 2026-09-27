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
import {
  MARKDOWN_BASE_SIZE,
  MARKDOWN_CHIP_BORDER_WIDTH,
  MARKDOWN_CHIP_FONT_SIZE,
  MARKDOWN_CHIP_LINE_HEIGHT,
  MARKDOWN_CHIP_PADDING_VERTICAL,
  MARKDOWN_TABLE_CHIP_LINE_HEIGHT,
  markdownChipBaselineShift,
  markdownProseScale,
  markdownZoomedLine
} from './mobile-markdown-prose-scale'

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

/** Instrument Sans ascent and descent per em (hhea of the bundled TTF). */
const ASCENT = 0.97
const DESCENT = 0.25
/** The reader's pinch zoom runs from 0.8 to 1.8 (FONT_SCALE_MIN/MAX). */
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8]

/** How far below the baseline the bottom of a line's box sits, when a pill
 *  of `pill` dp takes the line's ascent: its descent and half the leftover. */
function lineBottom(fontSize: number, lineHeight: number, pill: number): number {
  const ascent = Math.max(ASCENT * fontSize, pill)
  const descent = DESCENT * fontSize
  return descent + (lineHeight - ascent - descent) / 2
}

describe('an inline code chip inside a table', () => {
  it.each(['dark', 'light'] as const)('is not sliced off by the table clip at any zoom in %s', (scheme) => {
    // 2026-09-14, from the phone: a `54;1H` chip in a table row lost its top
    // and bottom. The chip is PAINTED lower than it is laid out so it sits
    // level with the text around it, and the table needs overflow:hidden for
    // its rounded corners. A cell's text follows the zoom as its pills do
    // (review of c3e62696), so the pill's bottom stays inside its own line,
    // and the padding under the last line is room to spare.
    const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as {
      tableCell: Box & { fontSize: number; lineHeight: number }
      inlineCodeChip: Box
    }
    const staticShift = styles.inlineCodeChip.transform?.find((entry) => entry.translateY !== undefined)?.translateY
    expect(staticShift).toBe(MARKDOWN_INLINE_CHIP_BASELINE_SHIFT)
    for (const zoom of ZOOMS) {
      const pill = MARKDOWN_TABLE_CHIP_LINE_HEIGHT * zoom + 2 * MARKDOWN_CHIP_PADDING_VERTICAL * zoom + 2 * MARKDOWN_CHIP_BORDER_WIDTH
      const shift = markdownChipBaselineShift(MARKDOWN_CHIP_FONT_SIZE, MARKDOWN_CHIP_LINE_HEIGHT) * zoom
      const cell = markdownZoomedLine(styles.tableCell.fontSize, styles.tableCell.lineHeight, zoom) ?? styles.tableCell
      expect(lineBottom(cell.fontSize, cell.lineHeight, pill) - shift, `zoom ${zoom}`).toBeGreaterThanOrEqual(1)
    }
  })

  it.each(['dark', 'light'] as const)('leaves a table with no code as it was in %s', (scheme) => {
    // 2026-09-27 review: the pill's bigger shift had grown every cell's
    // bottom padding, code or not. A pill no longer needs it; every cell
    // keeps the 2 dp it has had since 2026-09-14.
    const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as { tableCell: Box }
    expect(styles.tableCell.paddingVertical).toBeUndefined()
    expect(styles.tableCell.paddingBottom).toBe(space.xs + 2)
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
  /** 2026-09-27 review: the unrounded shift left an h4 heading's pill 0.04 dp
   *  inside its line. A dp of margin, whatever the rounding and the zoom. */
  const MIN_MARGIN = 1
  it.each(['dark', 'light'] as const)(
    'keeps a full line-gap above and below each pill in %s, at every zoom',
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
      }
      const pillAt = (zoom: number, lineHeight = MARKDOWN_CHIP_LINE_HEIGHT) =>
        lineHeight * zoom + 2 * MARKDOWN_CHIP_PADDING_VERTICAL * zoom + 2 * MARKDOWN_CHIP_BORDER_WIDTH
      // Unrounded: the static style rounds it, the zoomed one does not.
      const shiftAt = (zoom: number) => markdownChipBaselineShift(MARKDOWN_CHIP_FONT_SIZE, MARKDOWN_CHIP_LINE_HEIGHT) * zoom
      const check = (name: string, block: Block, pill: number, shift: number) => {
        expect(block.lineHeight - pill, `${name}: pill over pill`).toBeGreaterThanOrEqual(MIN_GAP)
        // A line holding a pill takes the pill's height as its ascent; the
        // pill's bottom, `shift` under the baseline, must stay inside it.
        expect(lineBottom(block.fontSize, block.lineHeight, pill) - shift, `${name}: pill inside its line`).toBeGreaterThanOrEqual(
          MIN_MARGIN
        )
      }
      // The prose zooms, and its line height with it (markdownProseScale).
      for (const zoom of ZOOMS) {
        for (const [name, block] of Object.entries({
          paragraph: styles.paragraph,
          listText: styles.listText,
          quoteText: styles.quoteText
        })) {
          const scaled = markdownProseScale(block.fontSize, zoom) ?? block
          check(`${name} at ${zoom}`, scaled, pillAt(zoom), shiftAt(zoom))
        }
      }
      // tableCell joins the list on 2026-09-15. A table's Branch column stacked
      // two pills of one split path and they collided and clipped (device
      // screenshot) — the cell's line height was BASE + 4 while a pill paints
      // BASE + 7. The invariant was right; it just was not asked about every
      // block a pill can land in, which is the whole lesson. Headings and
      // cells follow the zoom too since the review of c3e62696, when they
      // were checked at the reader's size only and met from zoom 1.35.
      for (const zoom of ZOOMS) {
        for (const [name, block, pill] of [
          ['tableCell', styles.tableCell, pillAt(zoom, MARKDOWN_TABLE_CHIP_LINE_HEIGHT)],
          ['heading', styles.heading, pillAt(zoom)],
          ['headingLevel1', { ...styles.heading, ...styles.headingLevel1 }, pillAt(zoom)],
          ['headingLevel2', { ...styles.heading, ...styles.headingLevel2 }, pillAt(zoom)],
          ['headingLevel3', { ...styles.heading, ...styles.headingLevel3 }, pillAt(zoom)]
        ] as const) {
          check(`${name} at ${zoom}`, markdownZoomedLine(block.fontSize, block.lineHeight, zoom) ?? block, pill, shiftAt(zoom))
        }
      }
      expect(MARKDOWN_BASE_SIZE).toBe(styles.paragraph.fontSize)
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
