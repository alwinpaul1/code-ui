import { describe, expect, it } from 'vitest'
import type { MarkupStroke } from './image-markup-strokes'
import {
  MARKUP_PEN_MIN_WIDTH_PX,
  displayPointToNatural,
  markupPenWidth,
  markupStrokePathData
} from './image-markup-geometry'

// The editor draws the photo — and the pen — inside a box that is smaller
// than the photo's own pixels (a 4000x3000 shot never fills the screen at
// 1:1). A stroke is recorded in the PHOTO's coordinates, not the screen's, so
// the mark lands under the same finger whether the box is small or the phone
// rotated, and so the flattened export (rendered at the photo's own
// resolution) draws it in the same place the finger touched.

describe('mapping a finger touch onto the photo behind it', () => {
  it('scales a point in the displayed box up to the photo\'s own pixels', () => {
    const drawn = { width: 200, height: 100 }
    const natural = { width: 2000, height: 1000 }
    expect(displayPointToNatural({ x: 20, y: 10 }, drawn, natural)).toEqual({ x: 200, y: 100 })
    expect(displayPointToNatural({ x: 0, y: 0 }, drawn, natural)).toEqual({ x: 0, y: 0 })
    expect(displayPointToNatural({ x: 200, y: 100 }, drawn, natural)).toEqual({ x: 2000, y: 1000 })
  })

  // A drag that runs past the edge of the box (a common way to draw right up
  // to a screenshot's border) must not push the stroke off the photo the
  // flatten renders, or the mark is lost past the canvas edge.
  it('clamps a touch that runs past the edge of the box to the photo\'s own edge', () => {
    const drawn = { width: 200, height: 100 }
    const natural = { width: 2000, height: 1000 }
    expect(displayPointToNatural({ x: -50, y: -5 }, drawn, natural)).toEqual({ x: 0, y: 0 })
    expect(displayPointToNatural({ x: 260, y: 140 }, drawn, natural)).toEqual({ x: 2000, y: 1000 })
  })

  it('never divides by a degenerate (zero-size) box', () => {
    expect(displayPointToNatural({ x: 5, y: 5 }, { width: 0, height: 0 }, { width: 2000, height: 1000 })).toEqual({
      x: 0,
      y: 0
    })
  })
})

describe('drawing a stroke as an SVG path', () => {
  it('renders an empty stroke as an empty path, drawing nothing', () => {
    expect(markupStrokePathData({ points: [] })).toBe('')
  })

  it('moves to the first point and lines through the rest, in order', () => {
    const stroke: MarkupStroke = {
      points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }]
    }
    expect(markupStrokePathData(stroke)).toBe('M0 0 L10 5 L20 0')
  })

  // The degenerate one-point case: no line is drawable, but the path must
  // still be well-formed (a lone "M" is valid SVG and paints nothing).
  it('draws a lone point as just a move, with no line', () => {
    expect(markupStrokePathData({ points: [{ x: 3, y: 4 }] })).toBe('M3 4')
  })

  it('rounds coordinates so the path stays short on a long freehand drag', () => {
    const stroke: MarkupStroke = { points: [{ x: 1.2345, y: 6.789 }, { x: 2, y: 2 }] }
    expect(markupStrokePathData(stroke)).toBe('M1.23 6.79 L2 2')
  })
})

describe('the pen width', () => {
  it('scales with the photo so a thin strokeWidth is not lost on a huge photo', () => {
    expect(markupPenWidth(1000)).toBeGreaterThan(markupPenWidth(100))
  })

  it('never draws thinner than a visible minimum on a tiny photo', () => {
    expect(markupPenWidth(10)).toBe(MARKUP_PEN_MIN_WIDTH_PX)
    expect(markupPenWidth(0)).toBe(MARKUP_PEN_MIN_WIDTH_PX)
  })
})
