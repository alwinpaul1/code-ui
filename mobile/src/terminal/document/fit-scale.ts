import { repositionOverlay } from './selection-overlay'
import {
  computeFitScale,
  flog,
  getCellWidth,
  getTotalScale,
  updateTransform
} from './viewport-transform'
import type { TerminalDocumentScope } from './document-scope'
import { scheduleDocumentFrame } from './document-frame-registry'
import { resetSmoothScrollOffset } from './normal-buffer-smooth-scroll'

/** The narrowest grid a fit or a text-scale change will fit to. */
export const MIN_FIT_COLS = 20

export function getCellHeight(scope: TerminalDocumentScope) {
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
// reads. clampPan(scope) and the horizontal-overflow test took them on EVERY
// touchmove, immediately before the style write that dirties layout again —
// a forced synchronous layout per finger sample. None of these change while a
// finger is down, so measure once (at touchstart, and after anything that can
// resize the grid or the window) and read the cache in between. The cache is
// `scope.surfaceMetrics` (ruling 21), so a remount starts from an invalid one.
export function invalidateSurfaceMetrics(scope: TerminalDocumentScope) {
  scope.surfaceMetrics.valid = false
}

export function getSurfaceMetrics(scope: TerminalDocumentScope) {
  if (scope.surfaceMetrics.valid) {
    return scope.surfaceMetrics
  }
  scope.surfaceMetrics.viewportW = window.innerWidth
  scope.surfaceMetrics.viewportH = window.innerHeight
  if (scope.term && scope.term.element) {
    scope.surfaceMetrics.contentW = scope.term.element.scrollWidth || 0
    scope.surfaceMetrics.contentH = scope.term.element.scrollHeight || 0
    scope.surfaceMetrics.valid = true
  }
  return scope.surfaceMetrics
}

// Why: pan horizontally only when content overflows the viewport (larger than
// fit) — the same test clampPan(scope) applies. Named so the touchmove path reads
// the decision instead of re-deriving it from a fresh layout read.
export function contentOverflowsViewportWidth(scope: TerminalDocumentScope) {
  const metrics = getSurfaceMetrics(scope)
  return metrics.contentW * getTotalScale(scope) > metrics.viewportW + 1
}

// Why: clamp pan so the terminal content always covers the viewport
// when zoomed in. When content is smaller than viewport in a
// dimension, pin to top-left (no floating in the middle).
export function clampPan(scope: TerminalDocumentScope) {
  if (!scope.term || !scope.term.element) {
    return
  }
  const scale = getTotalScale(scope)
  const metrics = getSurfaceMetrics(scope)
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
export function applyFitScale(scope: TerminalDocumentScope, reason: string) {
  if (!scope.term || !scope.term.element) {
    return
  }
  const token = ++scope.fitRetryToken
  let attempts = 0
  let lastScrollWidth = -1
  function attempt() {
    if (token !== scope.fitRetryToken) {
      return
    }
    if (!scope.term || !scope.term.element) {
      return
    }
    attempts++
    const cellW = getCellWidth(scope)
    if (cellW > 0 && scope.term.cols > 0) {
      commitFitScale(scope, reason, attempts, 'cellW')
      return
    }
    const w = scope.term.element.scrollWidth
    if (w > 0 && w === lastScrollWidth) {
      commitFitScale(scope, reason, attempts, 'stableSW')
      return
    }
    lastScrollWidth = w
    if (attempts >= FIT_RETRY_MAX_FRAMES) {
      flog(scope, 'commit-timeout', {
        reason: reason,
        attempts: attempts,
        cellW: cellW,
        scrollWidth: w,
        cols: scope.term.cols
      })
      commitFitScale(scope, reason, attempts, 'timeout')
      return
    }
    scheduleDocumentFrame(scope, attempt)
  }
  scheduleDocumentFrame(scope, attempt)
}

export function commitFitScale(
  scope: TerminalDocumentScope,
  reason: string,
  attempts: number,
  gate: string
) {
  if (!scope.term || !scope.term.element) {
    return
  }
  // Why: every fit runs after the grid or the window changed (init replay,
  // resize, reflow, text scale, orientation), which is exactly when the
  // cached content and viewport sizes stop being true.
  invalidateSurfaceMetrics(scope)
  const preSnapScale = computeFitScale(scope)
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
  resetSmoothScrollOffset(scope)
  updateTransform(scope)
  adjustRowsForViewport()

  const cellW = getCellWidth(scope)
  const sw = scope.term.element.scrollWidth
  const vpW = window.innerWidth
  const expectedW = cellW * scope.term.cols
  const suspect = scope.currentScale === 1 && scope.term.cols > 0 && expectedW > vpW + 1 // expected wider than viewport but no zoom
  if (suspect) {
    flog(scope, 'commit-SUSPECT', {
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
  repositionOverlay(scope)
}

/**
 * The refit every host needs: the viewport changed, so the scale the fit was computed against is
 * gone. A keyboard opening or closing, an orientation change, a shell resizing the container.
 *
 * Owned here because the refit is this module's own work — it was reached through the WebView's
 * message bridge only because that was where the listener happened to be installed, and the page
 * had to copy the five calls into its mount to get it at all (ruling 24).
 */
export function startFitScale(scope: TerminalDocumentScope) {
  const refit = () => {
    // Code UI: the surface metrics are cached per gesture (7097feea), and a
    // resize is exactly when they go stale — the keyboard took the height.
    invalidateSurfaceMetrics(scope)
    applyFitScale(scope, 'window-resize')
    adjustRowsForViewport()
    repositionOverlay(scope)
    clampPan(scope)
    updateTransform(scope)
  }
  window.addEventListener('resize', refit)
  scope.removeViewportRefit = () => {
    window.removeEventListener('resize', refit)
  }
}

/**
 * Ruling 21: the retry loop is abandoned by bumping the token it compares itself against, which is
 * how it already abandons a superseded attempt.
 */
export function stopFitScale(scope: TerminalDocumentScope) {
  scope.fitRetryToken++
  if (scope.removeViewportRefit) {
    scope.removeViewportRefit()
    scope.removeViewportRefit = null
  }
}
