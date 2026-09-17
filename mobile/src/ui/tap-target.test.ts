import { describe, expect, it } from 'vitest'

import { MIN_TAP_TARGET, tapTargetHitSlop } from './tap-target'

describe('tapTargetHitSlop', () => {
  it('grows a small square to the minimum on both axes', () => {
    // The browser toolbar's 26 dp glyph buttons (0.6.6 audit).
    expect(tapTargetHitSlop({ width: 26, height: 26 })).toEqual({
      top: 9,
      bottom: 9,
      left: 9,
      right: 9
    })
    expect(26 + 9 * 2).toBe(MIN_TAP_TARGET)
  })

  it('grows only the short axis of a wide control', () => {
    // The chat key strip: 30 tall, at least 38 wide.
    expect(tapTargetHitSlop({ height: 30, minWidth: 38 })).toEqual({
      top: 7,
      bottom: 7,
      left: 3,
      right: 3
    })
    // The host-edit Save button: 64 × 34.
    expect(tapTargetHitSlop({ width: 64, height: 34 })).toEqual({
      top: 5,
      bottom: 5,
      left: 0,
      right: 0
    })
  })

  it('rounds up, never leaving a target a fraction short', () => {
    expect(tapTargetHitSlop({ width: 33, height: 33 })).toEqual({
      top: 6,
      bottom: 6,
      left: 6,
      right: 6
    })
  })

  it('leaves a control that already reaches the minimum alone', () => {
    expect(tapTargetHitSlop({ width: 44, height: 44 })).toBeUndefined()
    expect(tapTargetHitSlop({ width: 60, minHeight: 48 })).toBeUndefined()
  })

  // The degenerate sizes. `minWidth: 0` is a flex child's permission to
  // shrink and a row with no height is content-sized; neither is "tiny".
  it('treats an absent or zero dimension as unknown, not as tiny', () => {
    expect(tapTargetHitSlop({})).toBeUndefined()
    expect(tapTargetHitSlop({ minWidth: 0 })).toBeUndefined()
    expect(tapTargetHitSlop({ width: 0, height: 0 })).toBeUndefined()
    // …but a known short axis beside an unknown one still earns its slop.
    expect(tapTargetHitSlop({ height: 32, minWidth: 0 })).toEqual({
      top: 6,
      bottom: 6,
      left: 0,
      right: 0
    })
  })
})
