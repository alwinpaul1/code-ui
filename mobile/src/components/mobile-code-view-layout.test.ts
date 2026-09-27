import { describe, expect, it } from 'vitest'
import { cutLineNote, displayColumns } from './mobile-code-indent'
import {
  CODE_VIEW_LINE_HEIGHT,
  CODE_VIEW_MAX_NO_WRAP_COLUMNS,
  codeViewListLayout,
  codeViewMetrics,
  defaultCodeViewWrap
} from './mobile-code-view-layout'

describe('the code grid', () => {
  it('uses JetBrains Mono’s own advance, 0.6 of the font size, for one column', () => {
    const metrics = codeViewMetrics({ lineCount: 40, maxColumns: 80, fontScale: 1 })
    expect(metrics.cellWidth).toBeCloseTo(13 * 0.6)
    expect(metrics.rowHeight).toBe(CODE_VIEW_LINE_HEIGHT)
  })

  it('grows with the phone’s font size setting, so the grid still matches the glyphs', () => {
    const metrics = codeViewMetrics({ lineCount: 40, maxColumns: 80, fontScale: 1.3 })
    expect(metrics.cellWidth).toBeCloseTo(13 * 0.6 * 1.3)
    expect(metrics.rowHeight).toBeCloseTo(CODE_VIEW_LINE_HEIGHT * 1.3)
  })

  // Review of 63858e9e (the same defect as the code pills'): from Android
  // 14 sp scale on a curve, so at 200% the 13 sp code is 25 dp and its 20 sp
  // line 34, where scaling by the font scale made them 26 and 40: rows 15%
  // too tall for jumps and folds, and indent guides drifting off the code.
  it('grows as Android 14 draws a large font size, on its curve', () => {
    const at200 = codeViewMetrics({ lineCount: 40, maxColumns: 80, fontScale: 2, apiLevel: 34 })
    expect(at200.cellWidth).toBeCloseTo(25 * 0.6)
    expect(at200.rowHeight).toBeCloseTo(34)
    // Linear up to Android 13, and below the curve's first scale.
    expect(codeViewMetrics({ lineCount: 40, maxColumns: 80, fontScale: 2, apiLevel: 33 }).rowHeight).toBeCloseTo(40)
    expect(codeViewMetrics({ lineCount: 40, maxColumns: 80, fontScale: 1.1, apiLevel: 34 }).rowHeight).toBeCloseTo(22)
  })

  it('widens the gutter with the highest line number, never below two digits', () => {
    expect(codeViewMetrics({ lineCount: 0, maxColumns: 0, fontScale: 1 }).gutterDigits).toBe(2)
    expect(codeViewMetrics({ lineCount: 9, maxColumns: 0, fontScale: 1 }).gutterDigits).toBe(2)
    expect(codeViewMetrics({ lineCount: 1200, maxColumns: 0, fontScale: 1 }).gutterDigits).toBe(4)
  })

  it('is wide enough for the longest line beside the gutter', () => {
    const metrics = codeViewMetrics({ lineCount: 40, maxColumns: 120, fontScale: 1 })
    expect(metrics.contentWidth).toBeGreaterThanOrEqual(metrics.gutterWidth + 120 * metrics.cellWidth)
  })

  it('stops widening at the no-wrap limit but for the cut line\'s note, so one minified line cannot make a view miles wide', () => {
    const atLimit = codeViewMetrics({ lineCount: 1, maxColumns: CODE_VIEW_MAX_NO_WRAP_COLUMNS, fontScale: 1 })
    const past = codeViewMetrics({ lineCount: 1, maxColumns: 1_000_000, fontScale: 1 })
    // Past the limit the line is cut, and only its note is added: the count
    // of what was left out, which must not be cut with it.
    const note = displayColumns(cutLineNote(1_000_000), 1)
    expect(past.contentWidth - atLimit.contentWidth).toBeGreaterThanOrEqual(Math.floor(note * past.cellWidth))
    expect(past.contentWidth - atLimit.contentWidth).toBeLessThanOrEqual(Math.ceil(note * past.cellWidth) + 1)
  })
})

describe('wrapping', () => {
  it('is off by default, as on the desktop, unless a line runs past the no-wrap limit', () => {
    expect(defaultCodeViewWrap({ maxColumns: 0 })).toBe(false)
    expect(defaultCodeViewWrap({ maxColumns: 180 })).toBe(false)
    expect(defaultCodeViewWrap({ maxColumns: CODE_VIEW_MAX_NO_WRAP_COLUMNS })).toBe(false)
    expect(defaultCodeViewWrap({ maxColumns: CODE_VIEW_MAX_NO_WRAP_COLUMNS + 1 })).toBe(true)
  })

  it('lays unwrapped code as one-line rows of a fixed height in a list as wide as the longest line', () => {
    const metrics = codeViewMetrics({ lineCount: 40, maxColumns: 120, fontScale: 1 })
    const layout = codeViewListLayout(false, metrics)
    expect(layout.horizontal).toBe(true)
    expect(layout.numberOfLines).toBe(1)
    expect(layout.listStyle).toEqual({ minWidth: metrics.contentWidth })
    expect(layout.rowStyle).toEqual({ height: metrics.rowHeight })
    expect(layout.getItemLayout?.(null, 0)).toEqual({ length: metrics.rowHeight, offset: 0, index: 0 })
    expect(layout.getItemLayout?.(null, 10)).toEqual({
      length: metrics.rowHeight,
      offset: metrics.rowHeight * 10,
      index: 10
    })
  })

  it('lets wrapped rows find their own height and width', () => {
    const metrics = codeViewMetrics({ lineCount: 40, maxColumns: 120, fontScale: 1 })
    const layout = codeViewListLayout(true, metrics)
    expect(layout.horizontal).toBe(false)
    expect(layout.numberOfLines).toBeUndefined()
    expect(layout.listStyle).toEqual({})
    expect(layout.rowStyle).toEqual({})
    expect(layout.getItemLayout).toBeUndefined()
  })
})
