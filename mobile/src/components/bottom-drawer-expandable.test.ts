import { describe, expect, it } from 'vitest'
import {
  dragExpandableSheet,
  expandableSheetHeights,
  settleExpandableSheet
} from './bottom-drawer-expandable'

// A Galaxy S23 in dp: 823 tall, 36 of status bar, the drawer's 16 top gap.
const HEIGHTS = expandableSheetHeights({ screenHeight: 823, topInset: 36, topGap: 16 })

describe('a sheet that opens part way and drags up to full screen', () => {
  it('opens at about two thirds of the screen and goes up to the status bar', () => {
    expect(HEIGHTS.full).toBe(771)
    expect(HEIGHTS.collapsed).toBe(Math.round(823 * 0.62))
    expect(HEIGHTS.collapsed).toBeLessThan(HEIGHTS.full)
  })

  it('never opens taller than it can grow, on a screen too short for both', () => {
    const short = expandableSheetHeights({ screenHeight: 300, topInset: 36, topGap: 16 })
    expect(short.collapsed).toBeLessThanOrEqual(short.full)
    expect(short.full).toBeGreaterThanOrEqual(0)
  })

  it('grows with the finger as it is dragged up, and stops at full height', () => {
    expect(dragExpandableSheet(HEIGHTS.collapsed, -100, HEIGHTS)).toEqual({
      height: HEIGHTS.collapsed + 100,
      translateY: 0
    })
    expect(dragExpandableSheet(HEIGHTS.collapsed, -2000, HEIGHTS).height).toBe(HEIGHTS.full)
  })

  it('shrinks back to its opening height first, then slides down past it', () => {
    expect(dragExpandableSheet(HEIGHTS.full, 100, HEIGHTS)).toEqual({
      height: HEIGHTS.full - 100,
      translateY: 0
    })
    const past = dragExpandableSheet(HEIGHTS.full, HEIGHTS.full - HEIGHTS.collapsed + 40, HEIGHTS)
    expect(past).toEqual({ height: HEIGHTS.collapsed, translateY: 40 })
  })

  it('opens fully on a quick flick up, or once dragged past half way', () => {
    expect(settleExpandableSheet({ height: HEIGHTS.collapsed + 20, translateY: 0, velocityY: -900 }, HEIGHTS)).toBe('full')
    const halfway = (HEIGHTS.collapsed + HEIGHTS.full) / 2
    expect(settleExpandableSheet({ height: halfway + 1, translateY: 0, velocityY: 0 }, HEIGHTS)).toBe('full')
    expect(settleExpandableSheet({ height: halfway - 1, translateY: 0, velocityY: 0 }, HEIGHTS)).toBe('collapsed')
  })

  it('drops back to its opening height on a flick down from full, rather than closing', () => {
    expect(settleExpandableSheet({ height: HEIGHTS.full - 30, translateY: 0, velocityY: 900 }, HEIGHTS)).toBe('collapsed')
  })

  it('closes when dragged well below its opening height, or flicked down from there', () => {
    expect(settleExpandableSheet({ height: HEIGHTS.collapsed, translateY: 81, velocityY: 0 }, HEIGHTS)).toBe('dismiss')
    expect(settleExpandableSheet({ height: HEIGHTS.collapsed, translateY: 10, velocityY: 900 }, HEIGHTS)).toBe('dismiss')
    expect(settleExpandableSheet({ height: HEIGHTS.collapsed, translateY: 30, velocityY: 0 }, HEIGHTS)).toBe('collapsed')
  })
})
