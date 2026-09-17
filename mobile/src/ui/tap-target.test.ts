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

/**
 * A hitSlop is not clipped to the control's own box: Android's
 * TouchTargetHelper inflates each child's rect by its slop and walks children in
 * REVERSE draw order, so the later sibling wins any overlap. Where a slop is
 * wider than the gap to its neighbour, the later control's target covers part of
 * the earlier control's DRAWN area, and a tap on what the user can see fires the
 * wrong action. In the browser toolbar that means tapping the right edge of Back
 * navigates Forward.
 *
 * Growing the target is not worth breaking which control it belongs to, so a
 * stated gap caps the horizontal slop at half of it: two neighbours' targets
 * meet exactly and neither crosses into the other's pixels.
 */
describe('a control with a neighbour beside it', () => {
  it('never reaches past the halfway point of the gap', () => {
    // 26 wide wants 9 a side; a 4 dp gap allows 2.
    expect(tapTargetHitSlop({ width: 26, height: 26 }, { horizontalGap: 4 })).toEqual({
      top: 9,
      bottom: 9,
      left: 2,
      right: 2
    })
  })

  it('takes no horizontal slop at all when the controls abut', () => {
    expect(tapTargetHitSlop({ width: 32, height: 32 }, { horizontalGap: 0 })).toEqual({
      top: 6,
      bottom: 6,
      left: 0,
      right: 0
    })
  })

  // The vertical axis has no neighbour in a row, so it is never capped: this is
  // what still buys most of the target back when the sides cannot grow.
  it('still grows vertically when the sides are capped to nothing', () => {
    const slop = tapTargetHitSlop({ width: 24, height: 24 }, { horizontalGap: 0 })
    expect(slop?.top).toBe(10)
    expect(slop?.left).toBe(0)
  })

  it('leaves the slop alone when the gap is wider than it needs', () => {
    expect(tapTargetHitSlop({ width: 26, height: 26 }, { horizontalGap: 40 })).toEqual(
      tapTargetHitSlop({ width: 26, height: 26 })
    )
  })

  // Degenerate: a control already big enough earns nothing, gap or no gap.
  it('returns nothing for a control that already reaches the minimum', () => {
    expect(tapTargetHitSlop({ width: 44, height: 44 }, { horizontalGap: 0 })).toBeUndefined()
  })

  // A capped-to-zero horizontal slop on an already-tall control leaves nothing
  // to apply, and an all-zero Insets would be a lie the audit could not see.
  it('returns nothing when the cap removes the only slop there was', () => {
    expect(tapTargetHitSlop({ width: 32, height: 44 }, { horizontalGap: 0 })).toBeUndefined()
  })
})
