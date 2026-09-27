// A sheet that opens part way and drags up to full screen, the way the Claude
// app's Background tasks and tool sheets behave (recordings of 2026-09-24):
// it opens at about two thirds of the screen, a drag up takes it to the
// status bar, a drag down takes it back, and a drag down from its opening
// height closes it. Pure, and marked as worklets, so the gesture handlers run
// them on the UI thread and the tests run them in Node.
//
// The sheet is laid out once, at full height, and only ever moved. Where it
// stands is an offset down from full height: 0 at full, the opening offset at
// its opening height, more while it is dragged towards closing. It used to be
// resized with the finger instead, which cost a layout pass on every frame of
// a drag and moved the list's top edge under the finger (2026-09-27).

/** The Claude app's Background tasks sheet opened with its top about a third
 *  of the way down the screen. */
const COLLAPSED_SHARE = 0.62
/** The drawer's own close distance and flick speed (use-bottom-drawer-drag.ts). */
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

/** How far below full height the sheet stands at its opening height. */
export function expandableSheetOpeningOffset(heights: ExpandableSheetHeights): number {
  'worklet'
  return heights.full - heights.collapsed
}

/** Where the sheet stands with the finger `translationY` from where the drag
 *  began at `startOffset`: with the finger all the way, down past its opening
 *  height too, and up no further than full height. */
export function dragExpandableSheet(startOffset: number, translationY: number): number {
  'worklet'
  return Math.max(0, startOffset + translationY)
}

/** Where the sheet comes to rest when the finger lifts with it at `offset`. */
export function settleExpandableSheet(
  at: { offset: number; velocityY: number },
  heights: ExpandableSheetHeights
): ExpandableSheetSettle {
  'worklet'
  const opening = expandableSheetOpeningOffset(heights)
  const belowOpening = at.offset - opening
  if (
    belowOpening >= -1 &&
    (belowOpening > DISMISS_THRESHOLD || (at.velocityY > FLICK_VELOCITY && belowOpening > 0))
  ) {
    return 'dismiss'
  }
  if (at.velocityY < -FLICK_VELOCITY) {
    return 'full'
  }
  if (at.velocityY > FLICK_VELOCITY) {
    return 'collapsed'
  }
  return at.offset < opening / 2 ? 'full' : 'collapsed'
}
