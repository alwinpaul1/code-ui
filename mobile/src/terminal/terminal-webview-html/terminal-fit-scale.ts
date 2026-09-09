import { TERMINAL_WEBVIEW_THEME_JS } from '../terminal-webview-theme-injected'

// Opens with the injected theme block: it lands at this point in the emitted document.
export const TERMINAL_HTML_FIT_SCALE = `${TERMINAL_WEBVIEW_THEME_JS}

  function getCellHeight() {
    if (!term || !term._core) return 15;
    var core = term._core;
    if (core._renderService && core._renderService.dimensions) {
      return core._renderService.dimensions.css.cell.height || 15;
    }
    return 15;
  }

  // Why: scrollWidth/scrollHeight and window.innerWidth/innerHeight are layout
  // reads. clampPan() and the horizontal-overflow test took them on EVERY
  // touchmove, immediately before the style write that dirties layout again —
  // a forced synchronous layout per finger sample. None of these change while a
  // finger is down, so measure once (at touchstart, and after anything that can
  // resize the grid or the window) and read the cache in between.
  var surfaceMetrics = { contentH: 0, contentW: 0, valid: false, viewportH: 0, viewportW: 0 };

  function invalidateSurfaceMetrics() {
    surfaceMetrics.valid = false;
  }

  function getSurfaceMetrics() {
    if (surfaceMetrics.valid) return surfaceMetrics;
    surfaceMetrics.viewportW = window.innerWidth;
    surfaceMetrics.viewportH = window.innerHeight;
    if (term && term.element) {
      surfaceMetrics.contentW = term.element.scrollWidth || 0;
      surfaceMetrics.contentH = term.element.scrollHeight || 0;
      surfaceMetrics.valid = true;
    }
    return surfaceMetrics;
  }

  // Why: pan horizontally only when content overflows the viewport (larger than
  // fit) — the same test clampPan() applies. Named so the touchmove path reads
  // the decision instead of re-deriving it from a fresh layout read.
  function contentOverflowsViewportWidth() {
    var metrics = getSurfaceMetrics();
    return metrics.contentW * getTotalScale() > metrics.viewportW + 1;
  }

  // Why: clamp pan so the terminal content always covers the viewport
  // when zoomed in. When content is smaller than viewport in a
  // dimension, pin to top-left (no floating in the middle).
  function clampPan() {
    if (!term || !term.element) return;
    var scale = getTotalScale();
    var metrics = getSurfaceMetrics();
    var cw = metrics.contentW * scale;
    var ch = metrics.contentH * scale;
    var vpW = metrics.viewportW;
    var vpH = metrics.viewportH;
    if (cw > vpW) {
      panX = Math.min(0, Math.max(vpW - cw, panX));
    } else {
      panX = 0;
    }
    if (ch > vpH) {
      panY = Math.min(0, Math.max(vpH - ch, panY));
    } else {
      panY = 0;
    }
  }

  // Why: intentional no-op. Mobile replays a live PTY snapshot then applies
  // live cursor-relative chunks from that same PTY; resizing only the WebView
  // xterm changes cursor coordinates and makes TUI repaint chunks duplicate or
  // overlap. Kept as a no-op so its call sites stay legible.
  function adjustRowsForViewport() {}

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
  var FIT_RETRY_MAX_FRAMES = 60;
  var fitRetryToken = 0;
  function applyFitScale(reason) {
    if (!term || !term.element) return;
    var token = ++fitRetryToken;
    var attempts = 0;
    var lastScrollWidth = -1;
    function attempt() {
      if (token !== fitRetryToken) return;
      if (!term || !term.element) return;
      attempts++;
      var cellW = getCellWidth();
      if (cellW > 0 && term.cols > 0) {
        commitFitScale(reason, attempts, 'cellW');
        return;
      }
      var w = term.element.scrollWidth;
      if (w > 0 && w === lastScrollWidth) {
        commitFitScale(reason, attempts, 'stableSW');
        return;
      }
      lastScrollWidth = w;
      if (attempts >= FIT_RETRY_MAX_FRAMES) {
        flog('commit-timeout', {
          reason: reason,
          attempts: attempts,
          cellW: cellW,
          scrollWidth: w,
          cols: term.cols
        });
        commitFitScale(reason, attempts, 'timeout');
        return;
      }
      requestAnimationFrame(attempt);
    }
    requestAnimationFrame(attempt);
  }

  function commitFitScale(reason, attempts, gate) {
    if (!term || !term.element) return;
    // Why: every fit runs after the grid or the window changed (init replay,
    // resize, reflow, text scale, orientation), which is exactly when the
    // cached content and viewport sizes stop being true.
    invalidateSurfaceMetrics();
    var preSnapScale = computeFitScale();
    currentScale = preSnapScale;
    // Why: when scale is very close to 1 (e.g. 0.97 from xterm scrollbar
    // sub-pixels) snap to 1 to avoid imperceptible shrinkage that prevents
    // a second applyFitScale from observing a "no-op needed" state.
    if (currentScale >= 0.95) currentScale = 1;
    userScale = 1;
    panX = 0;
    panY = 0;
    // Why: a fit follows a grid or viewport change, so the sub-row remainder no
    // longer describes anything. Clear it AND the transform it painted.
    resetSmoothScrollOffset();
    updateTransform();
    adjustRowsForViewport();

    var cellW = getCellWidth();
    var sw = term.element.scrollWidth;
    var vpW = window.innerWidth;
    var expectedW = cellW * term.cols;
    var suspect =
      currentScale === 1 && term.cols > 0 && expectedW > vpW + 1; // expected wider than viewport but no zoom
    if (suspect) {
      flog('commit-SUSPECT', {
        reason: reason,
        attempts: attempts,
        gate: gate,
        preSnapScale: preSnapScale,
        finalScale: currentScale,
        cellW: cellW,
        cols: term.cols,
        expectedW: expectedW,
        scrollWidth: sw,
        vpWidth: vpW
      });
    }
    repositionOverlay();
  }

`
