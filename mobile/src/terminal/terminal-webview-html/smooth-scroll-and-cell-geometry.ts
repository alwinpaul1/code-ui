export const TERMINAL_HTML_SMOOTH_SCROLL_AND_CELL_GEOMETRY = `  var SMOOTH_SCROLL_MAX_STEP_MS = 32;
  var SMOOTH_SCROLL_SETTLE_TAU_MS = 34;
  var SMOOTH_SCROLL_SETTLE_MIN_PX = 1;
  var SMOOTH_SCROLL_SETTLE_IDLE_MS = 140;

  function getTerminalScreenElement() {
    if (terminalScreenElement && terminalScreenElement.isConnected) return terminalScreenElement;
    if (!term || !term.element || !term.element.querySelector) return null;
    terminalScreenElement = term.element.querySelector('.xterm-screen');
    return terminalScreenElement;
  }

  // Why: xterm repaints committed rows on ITS OWN animation frame — the
  // requestAnimationFrame term.scrollLines() schedules runs one frame after the
  // one we are in. Writing the remainder in the same frame as the scrollLines
  // call therefore overshoots by a whole row for exactly one frame at every row
  // boundary, which is the shimmer that got fractional transforms banned here.
  // Deferring EVERY write by one frame pairs each remainder with the paint it
  // belongs to, so the content moves by exactly the finger's distance instead.
  function scheduleTerminalScreenTransform() {
    pendingTerminalScreenOffsetY = smoothScrollOffsetY;
    if (terminalScreenTransformFrameId !== null) return;
    terminalScreenTransformFrameId = requestAnimationFrame(function() {
      terminalScreenTransformFrameId = null;
      writeTerminalScreenTransform(pendingTerminalScreenOffsetY);
    });
  }

  function writeTerminalScreenTransform(offsetY) {
    var screenElement = getTerminalScreenElement();
    if (!screenElement) return;
    var scale = getTotalScale();
    if (!(scale > 0)) scale = 1;
    // Why: the remainder is measured in on-screen px but .xterm-screen sits
    // inside the scaled surface, so divide the scale back out. translate3d on a
    // will-change: transform layer keeps the move on the compositor — no
    // relayout, no xterm repaint, and it survives at the display's refresh rate.
    screenElement.style.transform = 'translate3d(0,' + (offsetY / scale) + 'px,0)';
  }

  function clampNormalScrollLines(lines) {
    if (!term || !term.buffer || !term.buffer.active || lines === 0) return 0;
    var buffer = term.buffer.active;
    if (lines > 0) {
      return Math.min(lines, Math.max(0, buffer.baseY - buffer.viewportY));
    }
    return Math.max(lines, -buffer.viewportY);
  }

  function canScrollNormalBufferDelta(deltaY) {
    if (!term || !term.buffer || !term.buffer.active || deltaY === 0) return false;
    var buffer = term.buffer.active;
    if (deltaY > 0) return buffer.viewportY < buffer.baseY;
    return buffer.viewportY > 0;
  }

  function applyNormalBufferScrollDelta(deltaY) {
    if (!term || deltaY === 0) return false;
    var effectiveCellH = getCellHeight() * getTotalScale();
    if (effectiveCellH <= 0) return false;
    if (!canScrollNormalBufferDelta(deltaY)) {
      resetSmoothScrollOffset();
      return false;
    }
    smoothScrollOffsetY -= deltaY;
    // Why: commit the row EAGERLY (ceil, not trunc) so the remainder always
    // lands in (-cellH, 0] — content is only ever pulled UP off the row grid,
    // never pushed down. xterm paints exactly term.rows rows, so a downward
    // remainder would expose unpainted background along the TOP edge; an upward
    // one hides in the partial row of dead space that rows = floor(viewport /
    // cellHeight) already leaves at the bottom.
    var lines = -Math.ceil(smoothScrollOffsetY / effectiveCellH);
    if (lines !== 0) {
      var applied = clampNormalScrollLines(lines);
      if (applied !== 0) {
        term.scrollLines(applied);
        smoothScrollOffsetY += applied * effectiveCellH;
      }
      if (applied !== lines) smoothScrollOffsetY = 0;
    }
    // Why: a guard against float drift only — the eager commit above already
    // keeps the remainder inside one row.
    if (smoothScrollOffsetY > effectiveCellH) smoothScrollOffsetY = effectiveCellH;
    if (smoothScrollOffsetY < -effectiveCellH) smoothScrollOffsetY = -effectiveCellH;
    scheduleTerminalScreenTransform();
    scheduleScrollIndicatorUpdate(true);
    return true;
  }

  function enqueueNormalBufferScrollDelta(deltaY) {
    if (!term || deltaY === 0) return false;
    if (!canScrollNormalBufferDelta(deltaY)) {
      resetSmoothScrollOffset();
      return false;
    }
    pendingNormalScrollDeltaY += deltaY;
    armSmoothScrollSettle();
    if (normalScrollFrameId !== null) return true;
    // Why: dense terminal rows are expensive to repaint. Coalesce touchmove
    // deltas into one xterm row-scroll per frame instead of repainting from
    // the input event stream.
    normalScrollFrameId = requestAnimationFrame(function() {
      normalScrollFrameId = null;
      var delta = pendingNormalScrollDeltaY;
      pendingNormalScrollDeltaY = 0;
      if (!applyNormalBufferScrollDelta(delta)) {
        resetSmoothScrollOffset();
      }
    });
    return true;
  }

  function resetSmoothScrollOffset() {
    pendingNormalScrollDeltaY = 0;
    cancelSmoothScrollSettle();
    if (normalScrollFrameId !== null) {
      cancelAnimationFrame(normalScrollFrameId);
      normalScrollFrameId = null;
    }
    flushDeferredKeyboardAvoidanceMetrics();
    if (smoothScrollOffsetY === 0) return;
    smoothScrollOffsetY = 0;
    scheduleTerminalScreenTransform();
    scheduleScrollIndicatorUpdate(false);
  }

  function cancelSmoothScrollSettle() {
    if (smoothScrollSettleTimer !== null) {
      clearTimeout(smoothScrollSettleTimer);
      smoothScrollSettleTimer = null;
    }
    if (smoothScrollSettleFrameId !== null) {
      cancelAnimationFrame(smoothScrollSettleFrameId);
      smoothScrollSettleFrameId = null;
    }
  }

  // Why: an external mouse wheel has no touchend to settle on, so the last
  // scroll of a burst arms the settle on a short idle timer. A touch gesture
  // cancels the timer and settles from touchend/momentum-end instead.
  function armSmoothScrollSettle() {
    if (smoothScrollSettleTimer !== null) clearTimeout(smoothScrollSettleTimer);
    smoothScrollSettleTimer = setTimeout(function() {
      smoothScrollSettleTimer = null;
      settleSmoothScrollOffset();
    }, SMOOTH_SCROLL_SETTLE_IDLE_MS);
  }

  // Why: the remainder has to reach 0 once the gesture ends, or every cell to
  // pixel mapping at rest (selection handles, taps, mouse reports) is off by a
  // fraction of a row. Zeroing it in one frame is a visible hop of up to a whole
  // row, so ease it onto the NEARER row boundary instead — 0, or one more row in
  // the direction already travelled. That is at most half a row of travel and
  // reads as a snap, never as a rubber band.
  function settleSmoothScrollOffset() {
    cancelSmoothScrollSettle();
    if (!term || smoothScrollOffsetY === 0) {
      flushDeferredKeyboardAvoidanceMetrics();
      return;
    }
    var effectiveCellH = getCellHeight() * getTotalScale();
    if (!(effectiveCellH > 0)) {
      resetSmoothScrollOffset();
      return;
    }
    smoothScrollSettleTargetY = smoothScrollOffsetY <= -effectiveCellH / 2 ? -effectiveCellH : 0;
    smoothScrollSettleTime = 0;
    smoothScrollSettleFrameId = requestAnimationFrame(smoothScrollSettleStep);
  }

  function smoothScrollSettleStep(frameTime) {
    smoothScrollSettleFrameId = null;
    var now = typeof frameTime === 'number' ? frameTime : nowMs();
    if (smoothScrollSettleTime === 0) smoothScrollSettleTime = now - 16;
    var elapsed = now - smoothScrollSettleTime;
    smoothScrollSettleTime = now;
    if (elapsed <= 0) elapsed = 1;
    if (elapsed > SMOOTH_SCROLL_MAX_STEP_MS) elapsed = SMOOTH_SCROLL_MAX_STEP_MS;
    var remaining = smoothScrollSettleTargetY - smoothScrollOffsetY;
    var step = Math.abs(remaining) <= SMOOTH_SCROLL_SETTLE_MIN_PX
      ? remaining
      : remaining * (1 - Math.exp(-elapsed / SMOOTH_SCROLL_SETTLE_TAU_MS));
    if (step === 0 || !applyNormalBufferScrollDelta(-step) || smoothScrollOffsetY === 0) {
      flushDeferredKeyboardAvoidanceMetrics();
      return;
    }
    smoothScrollSettleFrameId = requestAnimationFrame(smoothScrollSettleStep);
  }

  function cellToViewportPx(col, absRow) {
    if (!term) return { x: 0, y: 0 };
    var cellW = getCellWidth();
    var cellH = getCellHeight();
    var viewportRow = absRow - term.buffer.active.viewportY;
    var sx = col * cellW;
    var sy = viewportRow * cellH;
    var total = getTotalScale();
    // Why: the selection overlay lives in unscaled viewport coords OUTSIDE the
    // surface, so it has to add the same sub-row remainder the terminal screen
    // is translated by, or a handle drawn during a scroll sits up to a row away
    // from the cell it points at.
    return { x: sx * total + panX, y: sy * total + panY + pendingTerminalScreenOffsetY };
  }

  function getLineText(absRow) {
    if (!term) return '';
    var line = term.buffer.active.getLine(absRow);
    if (!line) return '';
    return line.translateToString(false);
  }

  // Why: getLineText collapses wide chars (emoji, CJK) to one string char, so a
  // tap's CELL column no longer equals the STRING index that url/path matchers use.
  // Convert by measuring the string length up to the tapped cell (the count of
  // string chars before it). Without this, taps on lines with a leading wide char
  // (e.g. agent output prefixed with ⏺) resolve to the wrong column and miss.
  function cellColToStringIndex(absRow, col) {
    if (!term) return col;
    var line = term.buffer.active.getLine(absRow);
    if (!line) return col;
    return line.translateToString(false, 0, col).length;
  }

  // File-path-under-tap detection (matchFilePathAtColumn). See
  // terminal-path-tap-injected.ts; mirrors the unit-tested terminal-path-tap.ts.
`
