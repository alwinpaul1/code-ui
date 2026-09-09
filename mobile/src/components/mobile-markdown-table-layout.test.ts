import { describe, expect, it } from 'vitest'
import {
  computeTableColumnWidths,
  TABLE_CELL_MAX_WIDTH,
  TABLE_CELL_MIN_WIDTH,
  tableColumnCount
} from './mobile-markdown-table-layout'

// The table from the Galaxy S23 screenshots (2026-09-09): header "Job | What |
// Result", body rows with a short first column and long second and third ones.
const headers = ['Job', 'What', 'Result']
const rows = [
  ['2621', 'Hook pass over the five from-scratch Gen1 models and the Gen4 family', 'Basis for every memory, link and bandwidth number'],
  ['2622', 'Corrected Hessian traces (STE)', 'ρ −0.08; the Hessian score was dropped'],
  ['2632', 'N=6 and N=8 CKA at 1000 frames', 'Six-layer validation']
]

describe('markdown table column widths', () => {
  it('gives every row the same column widths, so column N starts at one x everywhere', () => {
    const widths = computeTableColumnWidths({ headers, rows, columnCount: 3, fontSize: 13, horizontalPadding: 8 })
    expect(widths).toHaveLength(3)
    // The first column is short in every row: it takes the minimum, not the header's size.
    expect(widths[0]).toBe(TABLE_CELL_MIN_WIDTH)
    // The long columns are driven by their longest cell, capped.
    expect(widths[1]).toBe(TABLE_CELL_MAX_WIDTH)
    expect(widths[2]).toBe(TABLE_CELL_MAX_WIDTH)
  })

  it('sizes a medium column to its longest cell, between the bounds', () => {
    const widths = computeTableColumnWidths({
      headers: ['Name', 'State'],
      rows: [['Orca', 'Open'], ['Code UI', 'Connected · Relay']],
      columnCount: 2,
      fontSize: 13,
      horizontalPadding: 8
    })
    expect(widths[0]).toBe(TABLE_CELL_MIN_WIDTH)
    expect(widths[1]).toBeGreaterThan(TABLE_CELL_MIN_WIDTH)
    expect(widths[1]).toBeLessThan(TABLE_CELL_MAX_WIDTH)
  })

  it('counts columns across every row, so a ragged body row is not silently cut', () => {
    expect(tableColumnCount(['A', 'B'], [['1', '2', '3']])).toBe(3)
    expect(tableColumnCount([], [])).toBe(1)
  })

  it('does not charge for inline markup that never paints', () => {
    const plain = computeTableColumnWidths({ headers: ['x'], rows: [['abcdefghij']], columnCount: 1, fontSize: 13, horizontalPadding: 8 })
    const marked = computeTableColumnWidths({ headers: ['x'], rows: [['**abcdefghij**']], columnCount: 1, fontSize: 13, horizontalPadding: 8 })
    expect(marked).toEqual(plain)
  })
})
