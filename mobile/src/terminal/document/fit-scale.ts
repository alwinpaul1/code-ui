import { repositionOverlay } from './selection-overlay'
import {
  computeFitScale,
  flog,
  getCellWidth,
  getTotalScale,
  updateTransform
} from './viewport-transform'
import { scope } from './document-scope'
import { resetSmoothScrollOffset } from './normal-buffer-smooth-scroll'

export function getCellHeight() {
  if (!scope.term || !scope.term._core) {
    return 15
  }
  const core = scope.term._core
  if (core._renderService && core._renderService.dimensions) {
    return core._renderService.dimensions.css.cell.height || 15
  }
  return 15
}

/** The layout sizes a gesture reads, cached between the moments they can change. */
export type TerminalSurfaceMetrics = {
  contentH: number
  contentW: number
  valid: boolean
  viewportH: number
  viewportW: number
}

// Why: scrollWidth/scrollHeight and window.innerWidth/innerHeight are layout
// reads. clampPan() and the horizontal-overflow test took them on EVERY
// touchmove, immediately before the style write that dirties layout again —
// a forced synchronous layout per finger sample. None of these change while a
// finger is down, so measure once (at touchstart, and after anything that can
// resize the grid or the window) and read the cache in between.
const surfaceMetrics: TerminalSurfaceMetrics = {
  contentH: 0,
  contentW: 0,
  valid: false,
  viewportH: 0,
  viewportW: 0
}

export function invalidateSurfaceMetrics() {
  surfaceMetrics.valid = false
}

export function getSurfaceMetrics() {
  if (surfaceMetrics.valid) {
    return surfaceMetrics
  }
  surfaceMetrics.viewportW = window.innerWidth
  surfaceMetrics.viewportH = window.innerHeight
  if (scope.term && scope.term.element) {
    surfaceMetrics.contentW = scope.term.element.scrollWidth || 0
    surfaceMetrics.contentH = scope.term.element.scrollHeight || 0
    surfaceMetrics.valid = true
  }
  return surfaceMetrics
}

// Why: pan horizontally only when content overflows the viewport (larger than
// fit) — the same test clampPan() applies. Named so the touchmove path reads
// the decision instead of re-deriving it from a fresh layout read.
export function contentOverflowsViewportWidth() {
  const metrics = getSurfaceMetrics()
  return metrics.contentW * getTotalScale() > metrics.viewportW + 1
}

// Why: clamp pan so the terminal content always covers the viewport
// when zoomed in. When content is smaller than viewport in a
// dimension, pin to top-left (no floating in the middle).
export function clampPan() {
  if (!scope.term || !scope.term.element) {
    return
  }
  const scale = getTotalScale()
  const metrics = getSurfaceMetrics()
  const cw = metrics.contentW * scale
  const ch = metrics.contentH * scale
  const vpW = metrics.viewportW
  const vpH = metrics.viewportH
  if (cw > vpW) {
    scope.panX = Math.min(0, Math.max(vpW - cw, scope.panX))
  } else {
    scope.panX = 0
  }
  if (ch > vpH) {
    scope.panY = Math.min(0, Math.max(vpH - ch, scope.panY))
  } else {
    scope.panY = 0
  }
}

// Why: intentional no-op. Mobile replays a live PTY snapshot then applies
// live cursor-relative chunks from that same PTY; resizing only the WebView
// xterm changes cursor coordinates and makes TUI repaint chunks duplicate or
// overlap. Kept as a no-op so its call sites stay legible.
export function adjustRowsForViewport() {}

// Why: cold-start fit. After init() opens xterm, the renderer needs
// several frames before cell dimensions are computed. Reading too early
// gives cellWidth=0 (renderer service not ready) or scrollWidth=0 (DOM
// not laid out), and computeFitScale returns 1 → no zoom.
//
// Gate: cellWidth × cols is the canonical "logical width" of the grid
// and reflects xterm's layout decision, independent of buffer content.
// We commit when cellWidth becomes positive (renderer ready). Fallback:
// if cellWidth never becomes available, gate on stable positive
// scrollWidth (xterm rendered something). Cap at 60 frames (~1s @60Hz)
// so a backgrounded WebView never spins forever.
const FIT_RETRY_MAX_FRAMES = 60
let fitRetryToken = 0
export function applyFitScale(reason: string) {
  if (!scope.term || !scope.term.element) {
    return
  }
  const token = ++fitRetryToken
  let attempts = 0
  let lastScrollWidth = -1
  function attempt() {
    if (token !== fitRetryToken) {
      return
    }
    if (!scope.term || !scope.term.element) {
      return
    }
    attempts++
    const cellW = getCellWidth()
    if (cellW > 0 && scope.term.cols > 0) {
      commitFitScale(reason, attempts, 'cellW')
      return
    }
    const w = scope.term.element.scrollWidth
    if (w > 0 && w === lastScrollWidth) {
      commitFitScale(reason, attempts, 'stableSW')
      return
    }
    lastScrollWidth = w
    if (attempts >= FIT_RETRY_MAX_FRAMES) {
      flog('commit-timeout', {
        reason: reason,
        attempts: attempts,
        cellW: cellW,
        scrollWidth: w,
        cols: scope.term.cols
      })
      commitFitScale(reason, attempts, 'timeout')
      return
    }
    requestAnimationFrame(attempt)
  }
  requestAnimationFrame(attempt)
}

export function commitFitScale(reason: string, attempts: number, gate: string) {
  if (!scope.term || !scope.term.element) {
    return
  }
  // Why: every fit runs after the grid or the window changed (init replay,
  // resize, reflow, text scale, orientation), which is exactly when the
  // cached content and viewport sizes stop being true.
  invalidateSurfaceMetrics()
  const preSnapScale = computeFitScale()
  scope.currentScale = preSnapScale
  // Why: when scale is very close to 1 (e.g. 0.97 from xterm scrollbar
  // sub-pixels) snap to 1 to avoid imperceptible shrinkage that prevents
  // a second applyFitScale from observing a "no-op needed" state.
  if (scope.currentScale >= 0.95) {
    scope.currentScale = 1
  }
  scope.userScale = 1
  scope.panX = 0
  scope.panY = 0
  // Why: a fit follows a grid or viewport change, so the sub-row remainder no
  // longer describes anything. Clear it AND the transform it painted.
  resetSmoothScrollOffset()
  updateTransform()
  adjustRowsForViewport()

  const cellW = getCellWidth()
  const sw = scope.term.element.scrollWidth
  const vpW = window.innerWidth
  const expectedW = cellW * scope.term.cols
  const suspect = scope.currentScale === 1 && scope.term.cols > 0 && expectedW > vpW + 1 // expected wider than viewport but no zoom
  if (suspect) {
    flog('commit-SUSPECT', {
      reason: reason,
      attempts: attempts,
      gate: gate,
      preSnapScale: preSnapScale,
      finalScale: scope.currentScale,
      cellW: cellW,
      cols: scope.term.cols,
      expectedW: expectedW,
      scrollWidth: sw,
      vpWidth: vpW
    })
  }
  repositionOverlay()
}
