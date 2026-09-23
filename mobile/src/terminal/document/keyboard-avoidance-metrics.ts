import { notify } from './host-notify'
import { scope, type TerminalDocumentCell, type TerminalDocumentLine } from './document-scope'

export function lineHasVisibleContent(
  line: TerminalDocumentLine,
  cell: TerminalDocumentCell | null
) {
  if (line.translateToString(true).trim().length > 0) {
    return true
  }
  if (!cell || !line.getCell) {
    return false
  }
  const limit = Math.min(scope.term!.cols || 0, line.length || 0)
  for (let x = 0; x < limit; x++) {
    const current = line.getCell(x, cell)
    if (!current) {
      continue
    }
    if (!current.isBgDefault() || current.isInverse()) {
      return true
    }
    if (typeof current.isUnderline === 'function' && current.isUnderline()) {
      return true
    }
    if (typeof current.isStrikethrough === 'function' && current.isStrikethrough()) {
      return true
    }
    if (typeof current.isOverline === 'function' && current.isOverline()) {
      return true
    }
  }
  return false
}

export function computeContentBottomRow() {
  if (!scope.term || !scope.term.buffer || !scope.term.buffer.active) {
    return 0
  }
  const buffer = scope.term.buffer.active
  const top = buffer.viewportY || 0
  const cell = buffer.getNullCell ? buffer.getNullCell() : null
  for (let y = (scope.term.rows || 0) - 1; y >= 0; y--) {
    try {
      const line = buffer.getLine(top + y)
      if (line && lineHasVisibleContent(line, cell)) {
        return y
      }
    } catch {}
  }
  return 0
}

export function emitKeyboardAvoidanceMetrics() {
  if (!scope.term) {
    return
  }
  let alt = false
  try {
    alt =
      scope.term.buffer && scope.term.buffer.active && scope.term.buffer.active.type === 'alternate'
  } catch {}
  notify({
    type: 'keyboard-avoidance-metrics',
    cursorY: scope.term.buffer && scope.term.buffer.active ? scope.term.buffer.active.cursorY : 0,
    contentBottomRow: alt ? 0 : computeContentBottomRow(),
    rows: scope.term.rows || 0,
    altScreen: alt
  })
}

export function isScrollGestureActive() {
  if (scope.smoothScrollSettleFrameId !== null) {
    return true
  }
  return !!(scope.touchGesture && (scope.touchGesture.dragging || scope.touchGesture.momentumId))
}

// Why: emitKeyboardAvoidanceMetrics walks rows x cols cells and serializes a
// JSON postMessage, and onWriteParsed fires it on EVERY parsed write. A busy
// agent therefore lands that work on the same main thread as the frame a
// 120 Hz scroll is trying to hit. Hold it while the gesture, fling or settle
// is live and emit once at the end — the keyboard cannot open mid-scroll.
export function requestKeyboardAvoidanceMetrics() {
  if (isScrollGestureActive()) {
    scope.keyboardAvoidanceMetricsDeferred = true
    return
  }
  emitKeyboardAvoidanceMetrics()
}

export function flushDeferredKeyboardAvoidanceMetrics() {
  if (!scope.keyboardAvoidanceMetricsDeferred) {
    return
  }
  scope.keyboardAvoidanceMetricsDeferred = false
  emitKeyboardAvoidanceMetrics()
}
