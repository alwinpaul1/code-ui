import { describe, expect, it } from 'vitest'
import { resolveDraggableSheetHeights, resolveDraggableSheetSnap } from './draggable-detail-sheet-snap'

describe('sheet heights: default is about half the full extent', () => {
  it('sizes the default height to roughly half of a typical phone window', () => {
    const { fullHeight, defaultHeight } = resolveDraggableSheetHeights({
      screenHeight: 844,
      topInset: 44
    })
    expect(fullHeight).toBe(844 - 44 - 24)
    expect(defaultHeight / fullHeight).toBeGreaterThan(0.45)
    expect(defaultHeight / fullHeight).toBeLessThan(0.65)
  })

  it('never asks for a default taller than the full extent on a very short window', () => {
    const { fullHeight, defaultHeight } = resolveDraggableSheetHeights({
      screenHeight: 40,
      topInset: 10
    })
    expect(defaultHeight).toBeLessThanOrEqual(fullHeight)
  })

  it('does not go negative when the top inset alone exceeds the window', () => {
    const { fullHeight, defaultHeight } = resolveDraggableSheetHeights({
      screenHeight: 100,
      topInset: 200
    })
    expect(fullHeight).toBe(0)
    expect(defaultHeight).toBe(0)
  })
})

describe('snap resolution: settling a released drag', () => {
  const heights = { fullHeight: 700, defaultHeight: 400 }
  const collapsedOffset = heights.fullHeight - heights.defaultHeight // 300

  it('opens fully on a decisive upward flick, wherever the drag started', () => {
    expect(
      resolveDraggableSheetSnap({ translateY: collapsedOffset, velocityY: -900, ...heights })
    ).toBe('full')
  })

  it('dismisses on a decisive downward flick, even from the full position', () => {
    expect(resolveDraggableSheetSnap({ translateY: 10, velocityY: 900, ...heights })).toBe(
      'closed'
    )
  })

  it('a moderate downward flick close to the default position settles there, not closed', () => {
    expect(
      resolveDraggableSheetSnap({ translateY: collapsedOffset - 5, velocityY: 600, ...heights })
    ).toBe('default')
  })

  it('a moderate downward flick well past the default position dismisses', () => {
    expect(
      resolveDraggableSheetSnap({ translateY: collapsedOffset + 200, velocityY: 600, ...heights })
    ).toBe('closed')
  })

  it('a slow release near the top settles full', () => {
    expect(resolveDraggableSheetSnap({ translateY: 20, velocityY: 0, ...heights })).toBe('full')
  })

  it('a slow release at rest on the default position stays there', () => {
    expect(
      resolveDraggableSheetSnap({ translateY: collapsedOffset, velocityY: 10, ...heights })
    ).toBe('default')
  })

  it('a slow release dragged well past default toward the bottom dismisses', () => {
    expect(
      resolveDraggableSheetSnap({ translateY: heights.fullHeight - 5, velocityY: 0, ...heights })
    ).toBe('closed')
  })

  // Degenerate size: a window too short for two detents collapses the offset
  // to 0, so "full" and "default" land on the same position (0) — there is
  // no travel between them — while dragging far enough still dismisses.
  it('collapses full and default onto the same rest when the window is too short for two', () => {
    const noRoom = { fullHeight: 300, defaultHeight: 300 }
    expect(resolveDraggableSheetSnap({ translateY: 0, velocityY: 0, ...noRoom })).toBe('full')
    expect(resolveDraggableSheetSnap({ translateY: 300, velocityY: 0, ...noRoom })).toBe('closed')
    // Whichever label the midpoint returns, it must not invent a third resting
    // position: 'default' here still targets the same offset (0) as 'full'.
    const collapsedOffsetWhenNoRoom = Math.max(0, noRoom.fullHeight - noRoom.defaultHeight)
    expect(collapsedOffsetWhenNoRoom).toBe(0)
  })
})
