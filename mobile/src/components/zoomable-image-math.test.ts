import { describe, expect, it } from 'vitest'
import {
  ZOOM_DOUBLE_TAP,
  ZOOM_MAX,
  clampScale,
  clampTranslation,
  containedSize,
  doubleTapTarget,
  translationKeepingFocal
} from './zoomable-image-math'

// 2026-09-19: "can we click an image in a md preview to zoom it to read the
// text in it". A figure in thesis_explained.md is a 16:9 plot with axis
// labels the phone draws at ~4 px; the viewer has to let a pinch take it to
// where they read, and never let the picture drift off the screen.
const BOX = { width: 400, height: 800 }

describe('a figure pinched to read its labels', () => {
  it('fits a wide figure to the box width, a tall one to its height', () => {
    expect(containedSize(BOX, 16 / 9)).toEqual({ width: 400, height: 225 })
    expect(containedSize(BOX, 1 / 4)).toEqual({ width: 200, height: 800 })
    // No aspect known: the whole box.
    expect(containedSize(BOX, 0)).toEqual(BOX)
    expect(containedSize({ width: 0, height: 0 }, 1)).toEqual({ width: 0, height: 0 })
  })

  it('stops the zoom where text is still text', () => {
    expect(clampScale(0.3)).toBe(1)
    expect(clampScale(2.5)).toBe(2.5)
    expect(clampScale(40)).toBe(ZOOM_MAX)
  })

  it('keeps the point under the fingers still as the scale changes', () => {
    // Pinching at 100 px right of centre from 1x to 3x: the content point
    // there (100) must still be at 100, so translate = 100 - 100*3 = -200.
    expect(translationKeepingFocal({ x: 100, y: 0 }, { x: 0, y: 0 }, 1, 3)).toEqual({
      x: -200,
      y: 0
    })
    // Starting from an existing pan of +50 at 2x, zooming to 4x at centre.
    expect(translationKeepingFocal({ x: 0, y: 0 }, { x: 50, y: 0 }, 2, 4)).toEqual({ x: 100, y: 0 })
    // A degenerate from-scale must not divide by zero.
    expect(translationKeepingFocal({ x: 10, y: 10 }, { x: 0, y: 0 }, 0, 2)).toEqual({ x: 0, y: 0 })
  })

  it('will not let a zoomed figure drift off the screen', () => {
    const drawn = containedSize(BOX, 16 / 9)
    // At 3x the figure is 1200 wide in a 400 box: 400 px of slack each way.
    expect(clampTranslation({ x: 900, y: 0 }, drawn, BOX, 3)).toEqual({ x: 400, y: 0 })
    expect(clampTranslation({ x: -900, y: 0 }, drawn, BOX, 3)).toEqual({ x: -400, y: 0 })
    // 225 * 3 = 675 < 800 tall: the figure is still shorter than the box, so
    // it stays centred vertically whatever the finger did.
    expect(clampTranslation({ x: 0, y: 300 }, drawn, BOX, 3)).toEqual({ x: 0, y: 0 })
  })

  it('at fit, the figure is pinned to the centre', () => {
    const drawn = containedSize(BOX, 16 / 9)
    expect(clampTranslation({ x: 50, y: -50 }, drawn, BOX, 1)).toEqual({ x: 0, y: 0 })
  })

  it('double tap zooms in on the tapped spot, and a second one fits again', () => {
    const drawn = containedSize(BOX, 16 / 9)
    const zoomed = doubleTapTarget(1, { x: 100, y: 0 }, drawn, BOX)
    expect(zoomed.scale).toBe(ZOOM_DOUBLE_TAP)
    // The tapped point stays put: 100 - 100 * 2.5 = -150, within the 300 slack.
    expect(zoomed.translation).toEqual({ x: -150, y: 0 })
    expect(doubleTapTarget(ZOOM_DOUBLE_TAP, { x: 100, y: 0 }, drawn, BOX)).toEqual({
      scale: 1,
      translation: { x: 0, y: 0 }
    })
  })

  it('double tap near an edge zooms as far as the edge allows', () => {
    const drawn = containedSize(BOX, 16 / 9)
    const zoomed = doubleTapTarget(1, { x: 200, y: 0 }, drawn, BOX)
    // 200 - 200*2.5 = -300: exactly the slack, so the right edge meets the box.
    expect(zoomed.translation.x).toBe(-300)
  })
})
