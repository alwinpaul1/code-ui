import { getCellHeight } from './fit-scale'
import { getTotalScale, nowMs, scheduleScrollIndicatorUpdate } from './viewport-transform'
import { scope } from './document-scope'
import { flushDeferredKeyboardAvoidanceMetrics } from './keyboard-avoidance-metrics'

// The settle eases a sub-row remainder onto a boundary over a few frames, so
// a long frame there would visibly jump most of a row; 16ms keeps it from
// stair-stepping on a 120 Hz panel.
export const SMOOTH_SCROLL_MAX_STEP_MS = 16
// Momentum is different: it is the clock, not a fixed animation. A WebView
// hands out uneven frames, and clamping how much time a frame may account for
// makes a 30ms frame travel no further than a 15ms one — the fling stops
// tracking real time and the scroll stutters. This cap exists only so a long
// stall (a backgrounded tab, a GC pause) cannot teleport the content; it must
// stay well clear of ordinary frame variance. 0.3.5 lowered the single shared
// constant to 16ms for the settle above and took momentum down with it.
export const MOMENTUM_MAX_STEP_MS = 64
const SMOOTH_SCROLL_SETTLE_TAU_MS = 34
const SMOOTH_SCROLL_SETTLE_MIN_PX = 1
const SMOOTH_SCROLL_SETTLE_IDLE_MS = 140
export function getTerminalScreenElement() {
  if (scope.terminalScreenElement && scope.terminalScreenElement.isConnected) {
    return scope.terminalScreenElement
  }
  if (!scope.term || !scope.term.element || !scope.term.element.querySelector) {
    return null
  }
  scope.terminalScreenElement = scope.term.element.querySelector<HTMLElement>('.xterm-screen')
  return scope.terminalScreenElement
}

// Why: xterm repaints committed rows on ITS OWN animation frame — the
// requestAnimationFrame term.scrollLines() schedules runs one frame after the
// one we are in. Writing the remainder in the same frame as the scrollLines
// call therefore overshoots by a whole row for exactly one frame at every row
// boundary, which is the shimmer that got fractional transforms banned here.
// Deferring EVERY write by one frame pairs each remainder with the paint it
// belongs to, so the content moves by exactly the finger's distance instead.
export function scheduleTerminalScreenTransform() {
  scope.pendingTerminalScreenOffsetY = scope.smoothScrollOffsetY
  if (scope.terminalScreenTransformFrameId !== null) {
    return
  }
  scope.terminalScreenTransformFrameId = requestAnimationFrame(function () {
    scope.terminalScreenTransformFrameId = null
    writeTerminalScreenTransform(scope.pendingTerminalScreenOffsetY)
  })
}

// Why: the frame above is only a prediction of WHEN xterm paints. A write the
// agent streamed in the same frame has already booked xterm's next paint, so
// the committed rows land a frame before the remainder written for them — a
// whole row forward, then most of it back, at every boundary (measured in
// Chrome as +21px/-9px steps for a 6px finger). And under synchronized output
// xterm parks the repaint entirely until the closing sequence arrives over
// the relay. So term.onRender is the ground truth: record the row it painted
// and rewrite the transform right there, in the paint's own frame.
export function syncTerminalScreenTransformToRender() {
  if (!scope.term || !scope.term.buffer || !scope.term.buffer.active) {
    return
  }
  scope.renderedViewportY = scope.term.buffer.active.viewportY
  scope.renderedBufferType = scope.term.buffer.active.type
  if (scope.terminalScreenTransformFrameId !== null) {
    cancelAnimationFrame(scope.terminalScreenTransformFrameId)
    scope.terminalScreenTransformFrameId = null
    writeTerminalScreenTransform(scope.pendingTerminalScreenOffsetY)
    return
  }
  writeTerminalScreenTransform(scope.smoothScrollOffsetY)
}

// Why: rows the buffer has scrolled past but xterm has not painted yet must be
// carried by the transform, or the picture stands still (and later snaps)
// while the finger keeps moving. Once the paint lands the same call hands the
// distance back to the rows, so the content never jumps.
export function unpaintedRowsOffsetY() {
  if (
    scope.renderedViewportY < 0 ||
    !scope.term ||
    !scope.term.buffer ||
    !scope.term.buffer.active
  ) {
    return 0
  }
  // Why: a TUI switching to the alternate screen resets viewportY to 0 while
  // the last paint was of the normal buffer; that gap is not unpainted rows.
  if (scope.term.buffer.active.type !== scope.renderedBufferType) {
    return 0
  }
  const unpaintedRows = scope.term.buffer.active.viewportY - scope.renderedViewportY
  if (unpaintedRows === 0) {
    return 0
  }
  return -unpaintedRows * getCellHeight() * getTotalScale()
}

export function writeTerminalScreenTransform(offsetY: number) {
  const screenElement = getTerminalScreenElement()
  if (!screenElement) {
    return
  }
  let scale = getTotalScale()
  if (!(scale > 0)) {
    scale = 1
  }
  const visualOffsetY = offsetY + unpaintedRowsOffsetY() + scope.overscrollY
  if (visualOffsetY === scope.writtenTerminalScreenOffsetY) {
    return
  }
  scope.writtenTerminalScreenOffsetY = visualOffsetY
  // Why: the remainder is measured in on-screen px but .xterm-screen sits
  // inside the scaled surface, so divide the scale back out. translate3d on a
  // will-change: transform layer keeps the move on the compositor — no
  // relayout, no xterm repaint, and it survives at the display's refresh rate.
  screenElement.style.transform = 'translate3d(0,' + visualOffsetY / scale + 'px,0)'
}

export function clampNormalScrollLines(lines: number) {
  if (!scope.term || !scope.term.buffer || !scope.term.buffer.active || lines === 0) {
    return 0
  }
  const buffer = scope.term.buffer.active
  if (lines > 0) {
    return Math.min(lines, Math.max(0, buffer.baseY - buffer.viewportY))
  }
  return Math.max(lines, -buffer.viewportY)
}

export function canScrollNormalBufferDelta(deltaY: number) {
  if (!scope.term || !scope.term.buffer || !scope.term.buffer.active || deltaY === 0) {
    return false
  }
  const buffer = scope.term.buffer.active
  if (deltaY > 0) {
    return buffer.viewportY < buffer.baseY
  }
  return buffer.viewportY > 0
}

export function applyNormalBufferScrollDelta(deltaY: number) {
  if (!scope.term || deltaY === 0) {
    return false
  }
  const effectiveCellH = getCellHeight() * getTotalScale()
  if (effectiveCellH <= 0) {
    return false
  }
  if (!canScrollNormalBufferDelta(deltaY)) {
    resetSmoothScrollOffset()
    return false
  }
  scope.smoothScrollOffsetY -= deltaY
  // Why: commit the row EAGERLY (ceil, not trunc) so the remainder always
  // lands in (-cellH, 0] — content is only ever pulled UP off the row grid,
  // never pushed down. xterm paints exactly term.rows rows, so a downward
  // remainder would expose unpainted background along the TOP edge; an upward
  // one hides in the partial row of dead space that rows = floor(viewport /
  // cellHeight) already leaves at the bottom.
  const lines = -Math.ceil(scope.smoothScrollOffsetY / effectiveCellH)
  if (lines !== 0) {
    const applied = clampNormalScrollLines(lines)
    if (applied !== 0) {
      scope.term.scrollLines(applied)
      scope.smoothScrollOffsetY += applied * effectiveCellH
    }
    if (applied !== lines) {
      scope.smoothScrollOffsetY = 0
    }
  }
  // Why: a guard against float drift only — the eager commit above already
  // keeps the remainder inside one row.
  if (scope.smoothScrollOffsetY > effectiveCellH) {
    scope.smoothScrollOffsetY = effectiveCellH
  }
  if (scope.smoothScrollOffsetY < -effectiveCellH) {
    scope.smoothScrollOffsetY = -effectiveCellH
  }
  scheduleTerminalScreenTransform()
  scheduleScrollIndicatorUpdate(true)
  return true
}

// Why: apply the finger's delta NOW. Chromium already hands the page one
// touchmove per display frame, and xterm's own RenderDebouncer folds every
// scrollLines() of a frame into one repaint, so parking the delta in a second
// animation frame coalesced nothing — it only added a whole frame of lag on
// top of the one xterm needs to paint: three frames finger-to-glass at 120 Hz.
export function enqueueNormalBufferScrollDelta(deltaY: number) {
  if (!scope.term || deltaY === 0) {
    return false
  }
  if (!applyNormalBufferScrollDelta(deltaY)) {
    return false
  }
  armSmoothScrollSettle()
  return true
}

export function resetSmoothScrollOffset() {
  cancelSmoothScrollSettle()
  flushDeferredKeyboardAvoidanceMetrics()
  if (scope.smoothScrollOffsetY === 0) {
    return
  }
  scope.smoothScrollOffsetY = 0
  scheduleTerminalScreenTransform()
  scheduleScrollIndicatorUpdate(false)
}

export function cancelSmoothScrollSettle() {
  if (scope.smoothScrollSettleTimer !== null) {
    clearTimeout(scope.smoothScrollSettleTimer)
    scope.smoothScrollSettleTimer = null
  }
  if (scope.smoothScrollSettleFrameId !== null) {
    cancelAnimationFrame(scope.smoothScrollSettleFrameId)
    scope.smoothScrollSettleFrameId = null
  }
}

// Why: an external mouse wheel has no touchend to settle on, so the last
// scroll of a burst arms the settle on a short idle timer. A touch gesture
// cancels the timer and settles from touchend/momentum-end instead.
export function armSmoothScrollSettle() {
  if (scope.smoothScrollSettleTimer !== null) {
    clearTimeout(scope.smoothScrollSettleTimer)
  }
  scope.smoothScrollSettleTimer = setTimeout(function () {
    scope.smoothScrollSettleTimer = null
    settleSmoothScrollOffset()
  }, SMOOTH_SCROLL_SETTLE_IDLE_MS)
}

// Why: the remainder has to reach 0 once the gesture ends, or every cell to
// pixel mapping at rest (selection handles, taps, mouse reports) is off by a
// fraction of a row. Zeroing it in one frame is a visible hop of up to a whole
// row, so ease it onto the NEARER row boundary instead — 0, or one more row in
// the direction already travelled. That is at most half a row of travel and
// reads as a snap, never as a rubber band.
export function settleSmoothScrollOffset() {
  cancelSmoothScrollSettle()
  if (!scope.term || scope.smoothScrollOffsetY === 0) {
    flushDeferredKeyboardAvoidanceMetrics()
    return
  }
  const effectiveCellH = getCellHeight() * getTotalScale()
  if (!(effectiveCellH > 0)) {
    resetSmoothScrollOffset()
    return
  }
  scope.smoothScrollSettleTargetY =
    scope.smoothScrollOffsetY <= -effectiveCellH / 2 ? -effectiveCellH : 0
  scope.smoothScrollSettleTime = 0
  scope.smoothScrollSettleFrameId = requestAnimationFrame(smoothScrollSettleStep)
}

export function smoothScrollSettleStep(frameTime?: number) {
  scope.smoothScrollSettleFrameId = null
  const now = typeof frameTime === 'number' ? frameTime : nowMs()
  if (scope.smoothScrollSettleTime === 0) {
    scope.smoothScrollSettleTime = now - 16
  }
  let elapsed = now - scope.smoothScrollSettleTime
  scope.smoothScrollSettleTime = now
  if (elapsed <= 0) {
    elapsed = 1
  }
  if (elapsed > SMOOTH_SCROLL_MAX_STEP_MS) {
    elapsed = SMOOTH_SCROLL_MAX_STEP_MS
  }
  const remaining = scope.smoothScrollSettleTargetY - scope.smoothScrollOffsetY
  const step =
    Math.abs(remaining) <= SMOOTH_SCROLL_SETTLE_MIN_PX
      ? remaining
      : remaining * (1 - Math.exp(-elapsed / SMOOTH_SCROLL_SETTLE_TAU_MS))
  if (step === 0 || !applyNormalBufferScrollDelta(-step) || scope.smoothScrollOffsetY === 0) {
    flushDeferredKeyboardAvoidanceMetrics()
    return
  }
  scope.smoothScrollSettleFrameId = requestAnimationFrame(smoothScrollSettleStep)
}
