import { terminalDefaultTheme } from './document-constants'
import { repositionOverlay } from './selection-overlay'
import { shouldRouteScrollToTerminalInput } from './mouse-input-encoding'
import { scope } from './document-scope'
import { scrollIndicator, scrollThumb } from './text-scaling'
import { getSurfaceMetrics } from './fit-scale'

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void }
  }
}

scope.panX = 0
scope.panY = 0
scope.smoothScrollOffsetY = 0
// Why: the buffer row xterm has actually PAINTED, read back from term.onRender.
// -1 until the first paint of a terminal; xterm can hold a scroll's repaint for
// a frame (a write already booked it) or much longer (synchronized output).
scope.renderedViewportY = -1
scope.renderedBufferType = ''
scope.writtenTerminalScreenOffsetY = 0
// Why: the sub-row scroll remainder is painted as a compositor transform on
// xterm's own .xterm-screen, one frame behind the delta that produced it —
// see scheduleTerminalScreenTransform for why the frame of lag is required.
scope.terminalScreenElement = null
scope.pendingTerminalScreenOffsetY = 0
scope.terminalScreenTransformFrameId = null
scope.smoothScrollSettleFrameId = null
scope.smoothScrollSettleTimer = null
scope.smoothScrollSettleTargetY = 0
scope.smoothScrollSettleTime = 0
let scrollIndicatorFrameId: number | null = null
let pendingScrollIndicatorReveal = false
scope.initRows = 24
scope.terminalGeneration = 0
scope.defaultTheme = terminalDefaultTheme
scope.terminalThemeInput = null
scope.terminalTheme = scope.defaultTheme
scope.terminalMinimumContrastRatio = 3
scope.webglAddon = null
scope.webglRecoveryTimer = null
scope.activeAltScreenSnapshot = false
scope.trackedMouseTrackingMode = 'none'
scope.sgrMouseMode = false
scope.sgrMousePixelsMode = false
scope.initialOscLinks = []
scope.initialOscLinkRowOffset = 0
scope.initialOscLinkEvictionReady = false
scope.mouseModeScanTail = ''
scope.handledMessageIds = []
// Why: after init() the initial scrollback applyFitScale may have run
// against an empty buffer (or one without the widest line yet). Re-fit
// once when the first live data chunk arrives so a wider line that pushes
// scrollWidth past the previously-measured value gets re-scaled to fit.
scope.firstDataPending = false

// Diagnostic logger — bridges WebView console.log to RN via postMessage.
// Tag with [fit] so it's easy to filter in the Expo/Metro logs.
export function flog(tag: string, payload: Record<string, unknown>) {
  try {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({
          type: 'log',
          tag: '[fit]' + tag,
          payload: payload
        })
      )
    }
  } catch {}
}

// Why: Date.now() only resolves to a millisecond, so at 120 Hz a frame reads
// as 8, 9 or 0 ms — and a 0 used to drop the whole velocity sample, distance
// included. Every scroll timing decision reads the high-resolution clock.
export function nowMs() {
  if (window.performance && typeof window.performance.now === 'function') {
    return window.performance.now()
  }
  return Date.now()
}

export function getCellWidth() {
  if (!scope.term || !scope.term._core) {
    return 0
  }
  const core = scope.term._core
  if (core._renderService && core._renderService.dimensions) {
    return core._renderService.dimensions.css.cell.width || 0
  }
  return 0
}

// Why: width measurement strategy.
//   1. Prefer cellWidth × term.cols — this is what xterm's renderer uses
//      to lay out and is independent of buffer content. It's the "logical
//      width" of the terminal grid.
//   2. Fall back to term.element.scrollWidth — the actual rendered DOM
//      width — only when cellWidth isn't available yet (renderer not
//      initialized). This is content-dependent (reflects widest row),
//      but better than nothing.
//   3. If both are 0, return 1 (no scale change). The retry loop in
//      applyFitScale will keep trying until one is positive.
export function computeFitScale() {
  if (!scope.term) {
    return 1
  }
  const cellW = getCellWidth()
  const termWidth =
    cellW > 0 ? cellW * scope.term.cols : scope.term.element ? scope.term.element.scrollWidth : 0
  if (termWidth <= 0) {
    return 1
  }
  const vpWidth = window.innerWidth
  return Math.min(1, vpWidth / termWidth)
}

export function getTotalScale() {
  return scope.currentScale * scope.userScale
}

export function updateTransform() {
  scope.surface!.style.transform =
    'translate(' + scope.panX + 'px,' + scope.panY + 'px) scale(' + getTotalScale() + ')'
  scheduleScrollIndicatorUpdate(false)
  if (scope.selMode === 'select') {
    repositionOverlay()
  }
}

// Why: the indicator used to repaint twice per committed row (term.onScroll
// and the scroll delta itself), reading window.innerHeight each time. A fling
// commits several rows a frame, so that was several forced layouts per frame
// for a 3px-wide thumb. One repaint per frame is more than the thumb can show.
export function scheduleScrollIndicatorUpdate(reveal: boolean) {
  if (reveal) {
    pendingScrollIndicatorReveal = true
  }
  if (scrollIndicatorFrameId !== null) {
    return
  }
  scrollIndicatorFrameId = requestAnimationFrame(function () {
    scrollIndicatorFrameId = null
    const pendingReveal = pendingScrollIndicatorReveal
    pendingScrollIndicatorReveal = false
    updateScrollIndicator(pendingReveal)
  })
}

export function updateScrollIndicator(reveal: boolean) {
  if (
    !scrollIndicator ||
    !scrollThumb ||
    !scope.term ||
    !scope.term.buffer ||
    !scope.term.buffer.active
  ) {
    return
  }
  const buffer = scope.term.buffer.active
  const maxViewportY = buffer.baseY || 0
  if (maxViewportY <= 0 || shouldRouteScrollToTerminalInput()) {
    scrollIndicator.classList.remove('visible')
    return
  }
  const trackHeight = Math.max(0, getSurfaceMetrics().viewportH - 8)
  const totalRows = maxViewportY + (scope.term.rows || 0)
  if (trackHeight <= 0 || totalRows <= 0) {
    return
  }
  const thumbHeight = Math.max(24, (trackHeight * (scope.term.rows || 0)) / totalRows)
  const maxTop = Math.max(0, trackHeight - thumbHeight)
  const top = maxViewportY > 0 ? (buffer.viewportY / maxViewportY) * maxTop : 0
  scrollThumb.style.height = thumbHeight + 'px'
  scrollThumb.style.transform = 'translateY(' + top + 'px)'
  if (!reveal) {
    return
  }
  scrollIndicator.classList.add('visible')
  if (scope.scrollIndicatorHideTimer) {
    clearTimeout(scope.scrollIndicatorHideTimer)
  }
  scope.scrollIndicatorHideTimer = setTimeout(function () {
    scrollIndicator!.classList.remove('visible')
    scope.scrollIndicatorHideTimer = null
  }, 550)
}
