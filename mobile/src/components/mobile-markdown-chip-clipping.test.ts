import { describe, expect, it, vi } from 'vitest'

// makeMarkdownStyles calls StyleSheet.create; the real react-native entry is
// Flow-typed and this runner cannot parse it.
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import type { Theme } from '../theme/theme-context'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { androidSpScale, type SpScale } from './android-font-scale'
import { makeMarkdownStyles } from './mobile-markdown-styles'
import {
  MARKDOWN_BASE_SIZE,
  MARKDOWN_CHIP_BORDER_WIDTH,
  MARKDOWN_CHIP_PADDING_VERTICAL,
  markdownChipGeometry,
  markdownProseScale,
  markdownZoomedLine
} from './mobile-markdown-prose-scale'

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

/**
 * Where a pill is drawn in a line of words `fontSize` on `lineHeight`, from
 * the line's top: its frame hangs from the baseline, no taller than the
 * words' ascent, so the line is shared out around the words alone
 * (CustomLineHeightSpan), and the pill is drawn from the frame's top by its
 * shift (markdownChipGeometry, MobileMarkdownCodeChip).
 */
function pillInLine(fontSize: number, lineHeight: number, sp: SpScale = androidSpScale(1, 34)) {
  // In dp at the system font size: RN turns the type, the line and the
  // placeholder (the frame through toPixelFromSP) through the same curve.
  const geometry = markdownChipGeometry(fontSize, sp, lineHeight)
  const words = sp.toDp(fontSize)
  const line = sp.toDp(lineHeight)
  const placeholder = sp.toDp(geometry.frame)
  const ascent = Math.max(ASCENT * words, placeholder)
  const baseline = ascent + (line - ascent - DESCENT * words) / 2
  const top = baseline - placeholder + geometry.shift
  const height = sp.toDp(geometry.lineHeight) + 2 * MARKDOWN_CHIP_PADDING_VERTICAL + 2 * MARKDOWN_CHIP_BORDER_WIDTH
  return { top, bottom: top + height, height, line }
}

/** The system font sizes a pill is checked at: none, and Android 14's curve
 *  from 130% to 200% (review of 2ebd5ce6: this ran with sp as dp alone,
 *  and an h1's pill filled its line at 150% to 200%). */
const SYSTEM = [1, 1.3, 1.5, 1.8, 2].map((scale) => [scale, androidSpScale(scale, 34)] as const)

describe('an inline code chip inside a table', () => {
  it.each(['dark', 'light'] as const)('is not sliced off by the table clip at any zoom in %s', (scheme) => {
    // 2026-09-14, from the phone: a `54;1H` chip in a table row lost its top
    // and bottom. The chip is PAINTED away from where it is laid out so it
    // sits level with the text around it, and the table needs
    // overflow:hidden for its rounded corners. A cell's text follows the
    // zoom as its pills do (review of c3e62696), so the pill stays inside
    // its own line, and the padding under the last line is room to spare.
    const styles = makeMarkdownStyles(themeFor(scheme)) as unknown as {
      tableCell: Box & { fontSize: number; lineHeight: number }
      inlineCodeChip: Box
    }
    // The pill's own style carries no shift: each pill's frame does.
    expect(styles.inlineCodeChip.transform).toBeUndefined()
    for (const zoom of ZOOMS) {
      const cell = markdownZoomedLine(styles.tableCell.fontSize, styles.tableCell.lineHeight, zoom) ?? styles.tableCell
      for (const [scale, sp] of SYSTEM) {
        const pill = pillInLine(cell.fontSize, cell.lineHeight, sp)
        expect(pill.top, `zoom ${zoom} at ${scale * 100}%`).toBeGreaterThanOrEqual(1 - 1e-6)
        expect(pill.line - pill.bottom, `zoom ${zoom} at ${scale * 100}%`).toBeGreaterThanOrEqual(1 - 1e-6)
      }
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
//
// 2026-09-28: a pill's text is set from its words, so a heading's pill is a
// heading's size, and it hangs from a frame no taller than the words' ascent
// (markdownChipGeometry): read here from where it is drawn in its line.
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
      const check = (name: string, block: Block) => {
        // Set from the words around it since 2026-09-28: a heading's pill is
        // a heading's size.
        for (const [scale, sp] of SYSTEM) {
          const pill = pillInLine(block.fontSize, block.lineHeight, sp)
          const at = `${name} at ${scale * 100}%`
          expect(pill.line - pill.height, `${at}: pill over pill`).toBeGreaterThanOrEqual(MIN_GAP - 1e-6)
          expect(pill.top, `${at}: pill inside its line, above`).toBeGreaterThanOrEqual(MIN_MARGIN - 1e-6)
          expect(pill.line - pill.bottom, `${at}: pill inside its line, below`).toBeGreaterThanOrEqual(MIN_MARGIN - 1e-6)
        }
      }
      // The prose zooms, and its line height with it (markdownProseScale).
      for (const zoom of ZOOMS) {
        for (const [name, block] of Object.entries({
          paragraph: styles.paragraph,
          listText: styles.listText,
          quoteText: styles.quoteText
        })) {
          const scaled = markdownProseScale(block.fontSize, zoom) ?? block
          check(`${name} at ${zoom}`, scaled)
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
        for (const [name, block] of [
          ['tableCell', styles.tableCell],
          ['heading', styles.heading],
          ['headingLevel1', { ...styles.heading, ...styles.headingLevel1 }],
          ['headingLevel2', { ...styles.heading, ...styles.headingLevel2 }],
          ['headingLevel3', { ...styles.heading, ...styles.headingLevel3 }]
        ] as const) {
          check(`${name} at ${zoom}`, markdownZoomedLine(block.fontSize, block.lineHeight, zoom) ?? block)
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
