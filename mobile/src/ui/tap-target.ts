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
/**
 * NOT DONE, and the next person to touch this should do it: make `neighbours`
 * REQUIRED, with a named `NO_HORIZONTAL_NEIGHBOUR` for genuinely isolated
 * controls.
 *
 * Why the compiler and not an audit test. A 2026-09-17 review parsed every
 * hitSlop site and tried to resolve its container's gap from the StyleSheets:
 * 95 sites, 80 with a container in the same file, 53 with a gap it could
 * actually read. The 42 misses are structural, not fixable by a better regex —
 * 15 pressables ARE their component's root, so the gap lives in whichever
 * caller renders them (both browser cases, the two worst found, are these),
 * others put the gap on `contentContainerStyle`, and others space children by
 * margins with no gap at all, where "no gap" would read as 0 and flag them
 * falsely.
 *
 * Worse, ~31 gaps in this codebase are arithmetic rather than literals
 * (`space.xs + 2`, `spacing.sm + 2`). A regex reads `space.xs` and returns 4
 * where the real gap is 6, so the cap comes out at 2 instead of 3 and silently
 * NARROWS a target that was already correct. A wrong gap is worse than no gap
 * because it fails closed in a direction nobody reviews. The key strip's own
 * gap is one of these.
 *
 * A required parameter costs no parsing, covers the cross-file cases tsc does
 * not care about, is answered by the author who can see the layout rather than
 * inferred from a file that may not contain it, and fails at the call site
 * instead of in a list. It is what MobileNativeChatKeyStrip did by hand and
 * nothing else copied; the difference between a convention and a gate is
 * whether the compiler asks.
 *
 * Left undone on purpose: it means a layout judgement at ~35 call sites, and
 * making 35 of those in a hurry is exactly how a wrong gap gets in. Six sites
 * with a measured overlap are capped; 17 more have a horizontal component and
 * unknown neighbours (run the probe in the commit that added this note).
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
  // Clamped at 0: a negative inset SHRINKS the target this function exists to
  // grow, and `undefined` is returned only when both axes are 0, so a negative
  // would escape. Overlapping siblings (a negative gap) are a layout bug, and
  // the honest answer to one is no slop rather than a smaller control.
  const x =
    neighbours === undefined
      ? wanted
      : Math.max(0, Math.min(wanted, Math.floor(neighbours.horizontalGap / 2)))
  const y = height > 0 && height < MIN_TAP_TARGET ? Math.ceil((MIN_TAP_TARGET - height) / 2) : 0
  if (x === 0 && y === 0) {
    return undefined
  }
  return { top: y, bottom: y, left: x, right: x }
}
