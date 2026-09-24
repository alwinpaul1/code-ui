/** Pure layout/gesture math for `DraggableDetailSheet`, kept apart from the
 *  Reanimated/gesture-handler component so it can be unit tested without any
 *  of that stack (mirrors `bottom-drawer-fill-height.ts` / `bottom-drawer-
 *  keyboard-inset.ts`, which do the same for `BottomDrawer`). */

export type DraggableSheetHeights = {
  /** The sheet's full extent: the window height minus the top inset and a
   *  small gap, so the handle never sits under the status bar. */
  fullHeight: number
  /** The sheet's resting height when first opened — "about half the screen",
   *  per the Claude app (2026-09-24 evidence: opens at a default height,
   *  drags up to fill the screen). */
  defaultHeight: number
}

const DEFAULT_HEIGHT_RATIO = 0.55

/** `defaultHeight` is a ratio of `fullHeight`, not of the raw screen height —
 *  a landscape tablet with a tall top inset still gets a sensible half-sheet
 *  instead of one sized off space it does not have. Degenerates safely when
 *  the window is too short for any two-detent travel: `defaultHeight` is
 *  clamped to `fullHeight`, so `resolveDraggableSheetSnap` below never has to
 *  reason about a negative collapsed offset. */
export function resolveDraggableSheetHeights(params: {
  screenHeight: number
  topInset: number
  topGap?: number
}): DraggableSheetHeights {
  const { screenHeight, topInset, topGap = 24 } = params
  const fullHeight = Math.max(0, screenHeight - topInset - topGap)
  const defaultHeight = Math.min(fullHeight, Math.round(fullHeight * DEFAULT_HEIGHT_RATIO))
  return { fullHeight, defaultHeight }
}

export type DraggableSheetSnap = 'full' | 'default' | 'closed'

/** A downward flick at or above this speed (dp/s) always dismisses, wherever
 *  the drag started — matching `BottomDrawer`'s own dismiss velocity. */
const DISMISS_VELOCITY = 800
/** A flick at or above this speed, in either direction, out-votes position. */
const SNAP_VELOCITY = 500
const DEFAULT_DISMISS_THRESHOLD = 80

/**
 * Which of the sheet's three resting states a drag should end in, given
 * where the gesture let go and how fast it was moving.
 *
 * `translateY` is measured the same way the component keeps it: `0` at full
 * height, `fullHeight - defaultHeight` (the "collapsed offset") at the
 * default height, and `fullHeight` fully off-screen. A fast flick wins over
 * position in either direction; a slow drag settles by which resting point
 * it ended closest to, with `dismissThreshold` biasing the boundary between
 * "default" and "closed" so a small overshoot past the default position does
 * not read as a dismiss.
 */
export function resolveDraggableSheetSnap(params: {
  translateY: number
  velocityY: number
  fullHeight: number
  defaultHeight: number
  dismissThreshold?: number
}): DraggableSheetSnap {
  const {
    translateY,
    velocityY,
    fullHeight,
    defaultHeight,
    dismissThreshold = DEFAULT_DISMISS_THRESHOLD
  } = params
  const collapsedOffset = Math.max(0, fullHeight - defaultHeight)

  // A decisive upward flick always opens fully; a decisive downward one always
  // dismisses, matching the single-detent drawer's own velocity rule.
  if (velocityY <= -SNAP_VELOCITY) {
    return 'full'
  }
  if (velocityY >= DISMISS_VELOCITY) {
    return 'closed'
  }
  if (velocityY >= SNAP_VELOCITY) {
    return translateY > collapsedOffset + dismissThreshold ? 'closed' : 'default'
  }

  // No decisive flick: settle by position against the midpoints between the
  // three rests. When `defaultHeight` degenerates to `fullHeight` (a window
  // too short for two detents) `collapsedOffset` is 0, so `upperMid` is also
  // 0 and only 'full' or 'closed' are ever reachable — there is no default
  // detent to land on, which is correct: there was no travel to land it in.
  const upperMid = collapsedOffset / 2
  const lowerMid = collapsedOffset + (fullHeight - collapsedOffset) / 2
  if (translateY <= upperMid) {
    return 'full'
  }
  if (translateY <= lowerMid) {
    return 'default'
  }
  return 'closed'
}
