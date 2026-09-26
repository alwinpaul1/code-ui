import { describe, expect, it } from 'vitest'
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

  it('widens the gutter with the highest line number, never below two digits', () => {
    expect(codeViewMetrics({ lineCount: 0, maxColumns: 0, fontScale: 1 }).gutterDigits).toBe(2)
    expect(codeViewMetrics({ lineCount: 9, maxColumns: 0, fontScale: 1 }).gutterDigits).toBe(2)
    expect(codeViewMetrics({ lineCount: 1200, maxColumns: 0, fontScale: 1 }).gutterDigits).toBe(4)
  })

  it('is wide enough for the longest line beside the gutter', () => {
    const metrics = codeViewMetrics({ lineCount: 40, maxColumns: 120, fontScale: 1 })
    expect(metrics.contentWidth).toBeGreaterThanOrEqual(metrics.gutterWidth + 120 * metrics.cellWidth)
  })

  it('stops widening at the no-wrap limit, so one minified line cannot make a view miles wide', () => {
    const atLimit = codeViewMetrics({ lineCount: 1, maxColumns: CODE_VIEW_MAX_NO_WRAP_COLUMNS, fontScale: 1 })
    const past = codeViewMetrics({ lineCount: 1, maxColumns: 1_000_000, fontScale: 1 })
    expect(past.contentWidth).toBe(atLimit.contentWidth)
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
