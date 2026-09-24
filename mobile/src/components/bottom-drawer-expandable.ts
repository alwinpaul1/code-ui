// A sheet that opens part way and drags up to full screen, the way the Claude
// app's Background tasks and tool sheets behave (recordings of 2026-09-24):
// it opens at about two thirds of the screen, a drag up grows it to the
// status bar, a drag down shrinks it back, and a drag down from its opening
// height closes it. Pure, and marked as worklets, so the gesture handlers run
// them on the UI thread and the tests run them in Node.

/** The Claude app's Background tasks sheet opened with its top about a third
 *  of the way down the screen. */
const COLLAPSED_SHARE = 0.62
/** The drawer's own close distance and flick speed (mounted-bottom-drawer.tsx). */
const DISMISS_THRESHOLD = 80
const FLICK_VELOCITY = 500

export type ExpandableSheetHeights = { collapsed: number; full: number }

export type ExpandableSheetSettle = 'full' | 'collapsed' | 'dismiss'

export function expandableSheetHeights(input: {
  screenHeight: number
  topInset: number
  topGap: number
}): ExpandableSheetHeights {
  const full = Math.max(0, input.screenHeight - input.topInset - input.topGap)
  return { collapsed: Math.min(full, Math.round(input.screenHeight * COLLAPSED_SHARE)), full }
}

/** Where the sheet stands with the finger `translationY` from where the drag
 *  began at `startHeight`: taller or shorter while between its two heights,
 *  then sliding down once it is back at its opening height. */
export function dragExpandableSheet(
  startHeight: number,
  translationY: number,
  heights: ExpandableSheetHeights
): { height: number; translateY: number } {
  'worklet'
  const wanted = startHeight - translationY
  const height = Math.min(heights.full, Math.max(heights.collapsed, wanted))
  return { height, translateY: Math.max(0, heights.collapsed - wanted) }
}

/** Where the sheet comes to rest when the finger lifts. */
export function settleExpandableSheet(
  at: { height: number; translateY: number; velocityY: number },
  heights: ExpandableSheetHeights
): ExpandableSheetSettle {
  'worklet'
  const atOpening = at.height <= heights.collapsed + 1
  if (atOpening && (at.translateY > DISMISS_THRESHOLD || (at.velocityY > FLICK_VELOCITY && at.translateY > 0))) {
    return 'dismiss'
  }
  if (at.velocityY < -FLICK_VELOCITY) {
    return 'full'
  }
  if (at.velocityY > FLICK_VELOCITY) {
    return 'collapsed'
  }
  return at.height > (heights.collapsed + heights.full) / 2 ? 'full' : 'collapsed'
}
