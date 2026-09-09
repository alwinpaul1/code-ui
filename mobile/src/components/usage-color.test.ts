import { describe, expect, it } from 'vitest'
import { USAGE_COLOR_STOPS, usageColor } from './usage-color'

const stops = { success: '#3B8A5A', warning: '#B7791F', danger: '#C0392B' }

// Asked for on 2026-09-09 after the sheet showed 18%, 34%, 51% and 55% in one
// flat blue: usage must read by colour, and the colour must move with it.
describe('usage colour scale', () => {
  it('is green at rest, amber at 70 and red from 90', () => {
    expect(usageColor(0, stops)).toBe(stops.success)
    expect(usageColor(70, stops)).toBe(stops.warning.toLowerCase())
    expect(usageColor(90, stops)).toBe(stops.danger)
    expect(usageColor(100, stops)).toBe(stops.danger)
    expect(USAGE_COLOR_STOPS).toEqual([0, 70, 90])
  })

  it('gives distinct shades to the values the sheet showed', () => {
    const shades = [18, 34, 51, 55].map((pct) => usageColor(pct, stops))
    expect(new Set(shades).size).toBe(4)
  })

  it('moves monotonically toward red between the stops', () => {
    const red = (hex: string) => Number.parseInt(hex.slice(1, 3), 16)
    const series = [10, 30, 50, 69, 75, 85].map((pct) => red(usageColor(pct, stops)))
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]!)
    }
  })

  it('clamps out-of-range input', () => {
    expect(usageColor(-5, stops)).toBe(stops.success)
    expect(usageColor(250, stops)).toBe(stops.danger)
  })
})
