import { describe, expect, it } from 'vitest'
import {
  dragExpandableSheet,
  expandableSheetHeights,
  expandableSheetOpeningOffset,
  settleExpandableSheet
} from './bottom-drawer-expandable'

// A Galaxy S23 in dp: 823 tall, 36 of status bar, the drawer's 16 top gap.
const HEIGHTS = expandableSheetHeights({ screenHeight: 823, topInset: 36, topGap: 16 })
/** How far below full height the sheet stands at its opening height. */
const OPENING = expandableSheetOpeningOffset(HEIGHTS)

describe('a sheet that opens part way and drags up to full screen', () => {
  it('opens at about two thirds of the screen and goes up to the status bar', () => {
    expect(HEIGHTS.full).toBe(771)
    expect(HEIGHTS.collapsed).toBe(Math.round(823 * 0.62))
    expect(HEIGHTS.collapsed).toBeLessThan(HEIGHTS.full)
    expect(OPENING).toBe(HEIGHTS.full - HEIGHTS.collapsed)
  })

  it('never opens taller than it can grow, on a screen too short for both', () => {
    const short = expandableSheetHeights({ screenHeight: 300, topInset: 36, topGap: 16 })
    expect(short.collapsed).toBeLessThanOrEqual(short.full)
    expect(short.full).toBeGreaterThanOrEqual(0)
    expect(expandableSheetOpeningOffset(short)).toBeGreaterThanOrEqual(0)
  })

  it('rises with the finger as it is dragged up, and stops at full height', () => {
    expect(dragExpandableSheet(OPENING, -100)).toBe(OPENING - 100)
    expect(dragExpandableSheet(OPENING, -2000)).toBe(0)
  })

  it('goes back down to its opening height with the finger, then on past it', () => {
    expect(dragExpandableSheet(0, 100)).toBe(100)
    expect(dragExpandableSheet(0, OPENING + 40)).toBe(OPENING + 40)
  })

  it('carries on from where it was caught, when a drag starts while it moves', () => {
    expect(dragExpandableSheet(OPENING + 30, -50)).toBe(OPENING - 20)
  })

  it('opens fully on a quick flick up, or once dragged past half way', () => {
    expect(settleExpandableSheet({ offset: OPENING - 20, velocityY: -900 }, HEIGHTS)).toBe('full')
    expect(settleExpandableSheet({ offset: OPENING / 2 - 1, velocityY: 0 }, HEIGHTS)).toBe('full')
    expect(settleExpandableSheet({ offset: OPENING / 2 + 1, velocityY: 0 }, HEIGHTS)).toBe('collapsed')
  })

  it('drops back to its opening height on a flick down from full, rather than closing', () => {
    expect(settleExpandableSheet({ offset: 30, velocityY: 900 }, HEIGHTS)).toBe('collapsed')
  })

  it('closes when dragged well below its opening height, or flicked down from there', () => {
    expect(settleExpandableSheet({ offset: OPENING + 81, velocityY: 0 }, HEIGHTS)).toBe('dismiss')
    expect(settleExpandableSheet({ offset: OPENING + 10, velocityY: 900 }, HEIGHTS)).toBe('dismiss')
    expect(settleExpandableSheet({ offset: OPENING + 30, velocityY: 0 }, HEIGHTS)).toBe('collapsed')
  })
})
