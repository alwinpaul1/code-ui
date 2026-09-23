import type { TerminalDocumentScope } from './document-scope'
import { scheduleDocumentFrame } from './document-frame-registry'
import { getCellHeight } from './fit-scale'
import {
  SMOOTH_SCROLL_MAX_STEP_MS,
  scheduleTerminalScreenTransform
} from './normal-buffer-smooth-scroll'
import { getTotalScale, nowMs } from './viewport-transform'

/**
 * The scrollback's ends bend instead of stopping dead (Code UI 9a6507b6).
 *
 * Purely visual: no row is committed, and the spring returns the offset to exactly 0, so the
 * at-rest row-boundary invariant every cell-to-pixel mapping depends on holds. The bent offset is
 * the one piece of state another module reads — `writeTerminalScreenTransform` adds it to the
 * transform it writes. Ruling 21 puts the pull and the spring on the scope as well, so a remount
 * starts unbent; `stopOverscrollBend` takes back the spring frame.
 */

// UIScrollView's own resistance curve, f(x, d, c) = x*d*c / (d + c*x) with
// c = 0.55: the pull is compressed more the further it goes and approaches d,
// so the band never runs out and never lets the content leave the screen.
const OVERSCROLL_RESISTANCE_C = 0.55
const OVERSCROLL_SPRING_TAU_MS = 26
const OVERSCROLL_MIN_PX = 0.5

export function overscrollBend(pullPx: number, dimensionPx: number) {
  if (!(dimensionPx > 0) || pullPx === 0) {
    return 0
  }
  const x = pullPx < 0 ? -pullPx : pullPx
  const bent =
    (x * dimensionPx * OVERSCROLL_RESISTANCE_C) / (dimensionPx + OVERSCROLL_RESISTANCE_C * x)
  return pullPx < 0 ? -bent : bent
}

// Why not clientHeight: reading it forces layout, and this runs on every
// frame of a pull and of the spring back. rows x cell height is the same
// number from geometry this module already tracks, for free.
export function overscrollDimensionPx(scope: TerminalDocumentScope) {
  if (!scope.term || !scope.term.rows) {
    return 1
  }
  const height = scope.term.rows * getCellHeight(scope) * getTotalScale(scope)
  return height > 0 ? height : 1
}

export function cancelOverscrollSpring(scope: TerminalDocumentScope) {
  if (scope.overscrollSpringFrameId !== null) {
    cancelAnimationFrame(scope.overscrollSpringFrameId)
    scope.overscrollSpringFrameId = null
  }
}

export function setOverscrollPull(scope: TerminalDocumentScope, pullPx: number) {
  scope.overscrollPullY = pullPx
  const next = overscrollBend(pullPx, overscrollDimensionPx(scope))
  if (next === scope.overscrollY) {
    return
  }
  scope.overscrollY = next
  scheduleTerminalScreenTransform(scope)
}

// Why: the buffer end is the one place this scroller still read as a web page
// — the content simply refused to move. Bending is purely visual: no row is
// committed, and the spring below returns the offset to exactly 0, so the
// at-rest row-boundary invariant every cell-to-pixel mapping depends on holds.
export function pullOverscroll(scope: TerminalDocumentScope, deltaY: number) {
  if (deltaY === 0) {
    return
  }
  cancelOverscrollSpring(scope)
  setOverscrollPull(scope, scope.overscrollPullY - deltaY)
}

export function releaseOverscroll(scope: TerminalDocumentScope) {
  if (scope.overscrollPullY === 0 && scope.overscrollY === 0) {
    return
  }
  cancelOverscrollSpring(scope)
  scope.overscrollSpringTime = 0
  scope.overscrollSpringFrameId = scheduleDocumentFrame(scope, (time) =>
    overscrollSpringStep(scope, time)
  )
}

export function overscrollSpringStep(scope: TerminalDocumentScope, frameTime?: number) {
  scope.overscrollSpringFrameId = null
  const now = typeof frameTime === 'number' ? frameTime : nowMs()
  if (scope.overscrollSpringTime === 0) {
    scope.overscrollSpringTime = now - 16
  }
  let elapsed = now - scope.overscrollSpringTime
  scope.overscrollSpringTime = now
  if (elapsed <= 0) {
    elapsed = 1
  }
  if (elapsed > SMOOTH_SCROLL_MAX_STEP_MS) {
    elapsed = SMOOTH_SCROLL_MAX_STEP_MS
  }
  const decay = Math.exp(-elapsed / OVERSCROLL_SPRING_TAU_MS)
  const next = scope.overscrollPullY * decay
  if ((next < 0 ? -next : next) <= OVERSCROLL_MIN_PX) {
    setOverscrollPull(scope, 0)
    return
  }
  setOverscrollPull(scope, next)
  scope.overscrollSpringFrameId = scheduleDocumentFrame(scope, (time) =>
    overscrollSpringStep(scope, time)
  )
}

/** Ruling 21: the spring-back frame, which would otherwise bend the next mount's content. */
export function stopOverscrollBend(scope: TerminalDocumentScope) {
  cancelOverscrollSpring(scope)
}
