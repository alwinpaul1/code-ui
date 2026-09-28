import { describe, expect, it } from 'vitest'
import {
  MARKDOWN_BASE_SIZE,
  MARKDOWN_PROSE_LINE_HEIGHT,
  markdownChipFootprint,
  markdownChipScale,
  markdownProseScale
} from './mobile-markdown-prose-scale'

// Reported from the device 2026-09-15 with a screenshot: inline code pills drawn
// ON TOP of the words beside them, and visibly larger than the prose.
//
// The static styles carry a tuned invariant — the paragraph's line height must
// clear a pill's painted footprint, because Android ignores an inline View's
// vertical margins and the line box is the only separation there is. The
// collision test pinned it on the static styles only, so the pinch-zoom path
// broke the same invariant unseen.
const MIN_GAP = 3
const ZOOMS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 2]

describe('prose and its inline pills at every zoom', () => {
  it('keeps a line tall enough for a pill at every zoom', () => {
    for (const zoom of ZOOMS) {
      const prose = markdownProseScale(MARKDOWN_BASE_SIZE, zoom)
      const lineHeight = prose?.lineHeight ?? MARKDOWN_PROSE_LINE_HEIGHT
      expect(
        lineHeight,
        `zoom ${zoom}: line ${lineHeight} vs pill ${markdownChipFootprint(zoom)}`
      ).toBeGreaterThanOrEqual(markdownChipFootprint(zoom) + MIN_GAP)
    }
  })

  it('scales the pill with the prose rather than leaving it behind', () => {
    const small = markdownChipScale(0.8)
    const large = markdownChipScale(1.5)
    expect(small!.fontSize).toBeLessThan(large!.fontSize)
    // The pill tracks the prose: same factor, so it never dwarfs the text.
    expect(small!.fontSize / large!.fontSize).toBeCloseTo(0.8 / 1.5, 5)
  })

  it('changes nothing at all when the reader has not zoomed', () => {
    expect(markdownProseScale(MARKDOWN_BASE_SIZE, 1)).toBe(null)
    expect(markdownChipScale(1)).toBe(null)
  })

  it('uses the prose line height the static style uses, not a smaller one', () => {
    // The line is the pill's headroom; recomputing it as the size + 8 is what
    // shipped. The +2 is the pill's two 1px borders, which do not scale and
    // would otherwise eat that headroom at small zooms. The line is the
    // Claude app's pitch since 2026-09-28 (MARKDOWN_PROSE_LINE_HEIGHT).
    const prose = markdownProseScale(MARKDOWN_BASE_SIZE, 2)
    expect(prose!.lineHeight).toBeCloseTo(MARKDOWN_PROSE_LINE_HEIGHT * 2 + 2, 9)
  })

  it('reads a degenerate zoom without collapsing the line', () => {
    const prose = markdownProseScale(MARKDOWN_BASE_SIZE, 0.5)
    expect(prose!.lineHeight).toBeGreaterThanOrEqual(markdownChipFootprint(0.5) + MIN_GAP)
  })
})
