import type { Insets } from 'react-native'

/** Apple's minimum tap target, and Android's 48dp is close enough that
 *  reaching this reaches most of that. Effective size, not drawn size: a
 *  26 dp glyph with 9 dp of slop each side is a 44 dp target. */
export const MIN_TAP_TARGET = 44

type Size = {
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
}

/**
 * The `hitSlop` that grows a control to MIN_TAP_TARGET on each axis it is
 * short on, or `undefined` when it already reaches it. Pass the style the
 * control is drawn with (StyleSheet.create returns the object as given), so
 * the slop follows the size and the two cannot drift apart.
 *
 * A dimension that is absent or 0 is unknown, not tiny: `minWidth: 0` is
 * how a flex child is told it may shrink, and a row with no height set is
 * as tall as its content. Only a stated size below the minimum earns slop.
 */
type Neighbours = {
  /**
   * The gap, in dp, between this control and the one beside it. Pass it
   * wherever a control has a horizontal neighbour — including a gap of 0.
   */
  horizontalGap: number
}

export function tapTargetHitSlop(size: Size, neighbours?: Neighbours): Insets | undefined {
  const width = size.width || size.minWidth || 0
  const height = size.height || size.minHeight || 0
  const wanted = width > 0 && width < MIN_TAP_TARGET ? Math.ceil((MIN_TAP_TARGET - width) / 2) : 0
  // Why half, and why floor: a hitSlop is NOT clipped to the control's box.
  // Android's TouchTargetHelper inflates every child's rect by its slop and
  // tests children in reverse draw order, so the later sibling wins an overlap
  // and its target covers part of the earlier sibling's DRAWN pixels — a tap on
  // what the user can see fires the wrong control. At half the gap two
  // neighbours' targets meet exactly and neither crosses. Flooring keeps them
  // from meeting one pixel late on an odd gap.
  const x =
    neighbours === undefined ? wanted : Math.min(wanted, Math.floor(neighbours.horizontalGap / 2))
  const y = height > 0 && height < MIN_TAP_TARGET ? Math.ceil((MIN_TAP_TARGET - height) / 2) : 0
  if (x === 0 && y === 0) {
    return undefined
  }
  return { top: y, bottom: y, left: x, right: x }
}
