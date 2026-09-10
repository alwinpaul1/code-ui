export const TERMINAL_HTML_SMOOTH_SCROLL_AND_CELL_GEOMETRY = `  var SMOOTH_SCROLL_MAX_STEP_MS = 16;
  var SMOOTH_SCROLL_SETTLE_TAU_MS = 34;
  var SMOOTH_SCROLL_SETTLE_MIN_PX = 1;
  var SMOOTH_SCROLL_SETTLE_IDLE_MS = 140;
  // UIScrollView's own resistance curve, f(x, d, c) = x*d*c / (d + c*x) with
  // c = 0.55: the pull is compressed more the further it goes and approaches d,
  // so the band never runs out and never lets the content leave the screen.
  var OVERSCROLL_RESISTANCE_C = 0.55;
  var OVERSCROLL_SPRING_TAU_MS = 26;
  var OVERSCROLL_MIN_PX = 0.5;
  var overscrollPullY = 0;
  var overscrollY = 0;
  var overscrollSpringFrameId = null;
  var overscrollSpringTime = 0;

  function overscrollBend(pullPx, dimensionPx) {
    if (!(dimensionPx > 0) || pullPx === 0) return 0;
    var x = pullPx < 0 ? -pullPx : pullPx;
    var bent = (x * dimensionPx * OVERSCROLL_RESISTANCE_C) /
      (dimensionPx + OVERSCROLL_RESISTANCE_C * x);
    return pullPx < 0 ? -bent : bent;
  }

  // Why not clientHeight: reading it forces layout, and this runs on every
  // frame of a pull and of the spring back. rows x cell height is the same
  // number from geometry this module already tracks, for free.
  function overscrollDimensionPx() {
    if (!term || !term.rows) return 1;
    var height = term.rows * getCellHeight() * getTotalScale();
    return height > 0 ? height : 1;
  }

  function cancelOverscrollSpring() {
    if (overscrollSpringFrameId !== null) {
      cancelAnimationFrame(overscrollSpringFrameId);
      overscrollSpringFrameId = null;
    }
  }

  function setOverscrollPull(pullPx) {
    overscrollPullY = pullPx;
    var next = overscrollBend(pullPx, overscrollDimensionPx());
    if (next === overscrollY) return;
    overscrollY = next;
    scheduleTerminalScreenTransform();
  }

  // Why: the buffer end is the one place this scroller still read as a web page
  // — the content simply refused to move. Bending is purely visual: no row is
  // committed, and the spring below returns the offset to exactly 0, so the
  // at-rest row-boundary invariant every cell-to-pixel mapping depends on holds.
  function pullOverscroll(deltaY) {
    if (deltaY === 0) return;
    cancelOverscrollSpring();
    setOverscrollPull(overscrollPullY - deltaY);
  }

  function releaseOverscroll() {
    if (overscrollPullY === 0 && overscrollY === 0) return;
    cancelOverscrollSpring();
    overscrollSpringTime = 0;
    overscrollSpringFrameId = requestAnimationFrame(overscrollSpringStep);
  }

  function overscrollSpringStep(frameTime) {
    overscrollSpringFrameId = null;
    var now = typeof frameTime === 'number' ? frameTime : nowMs();
    if (overscrollSpringTime === 0) overscrollSpringTime = now - 16;
    var elapsed = now - overscrollSpringTime;
    overscrollSpringTime = now;
    if (elapsed <= 0) elapsed = 1;
    if (elapsed > SMOOTH_SCROLL_MAX_STEP_MS) elapsed = SMOOTH_SCROLL_MAX_STEP_MS;
    var decay = Math.exp(-elapsed / OVERSCROLL_SPRING_TAU_MS);
    var next = overscrollPullY * decay;
    if ((next < 0 ? -next : next) <= OVERSCROLL_MIN_PX) {
      setOverscrollPull(0);
      return;
    }
    setOverscrollPull(next);
    overscrollSpringFrameId = requestAnimationFrame(overscrollSpringStep);
  }

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

  // Why: the frame above is only a prediction of WHEN xterm paints. A write the
  // agent streamed in the same frame has already booked xterm's next paint, so
  // the committed rows land a frame before the remainder written for them — a
  // whole row forward, then most of it back, at every boundary (measured in
  // Chrome as +21px/-9px steps for a 6px finger). And under synchronized output
  // xterm parks the repaint entirely until the closing sequence arrives over
  // the relay. So term.onRender is the ground truth: record the row it painted
  // and rewrite the transform right there, in the paint's own frame.
  function syncTerminalScreenTransformToRender() {
    if (!term || !term.buffer || !term.buffer.active) return;
    renderedViewportY = term.buffer.active.viewportY;
    renderedBufferType = term.buffer.active.type;
    if (terminalScreenTransformFrameId !== null) {
      cancelAnimationFrame(terminalScreenTransformFrameId);
      terminalScreenTransformFrameId = null;
      writeTerminalScreenTransform(pendingTerminalScreenOffsetY);
      return;
    }
    writeTerminalScreenTransform(smoothScrollOffsetY);
  }

  // Why: rows the buffer has scrolled past but xterm has not painted yet must be
  // carried by the transform, or the picture stands still (and later snaps)
  // while the finger keeps moving. Once the paint lands the same call hands the
  // distance back to the rows, so the content never jumps.
  function unpaintedRowsOffsetY() {
    if (renderedViewportY < 0 || !term || !term.buffer || !term.buffer.active) return 0;
    // Why: a TUI switching to the alternate screen resets viewportY to 0 while
    // the last paint was of the normal buffer; that gap is not unpainted rows.
    if (term.buffer.active.type !== renderedBufferType) return 0;
    var unpaintedRows = term.buffer.active.viewportY - renderedViewportY;
    if (unpaintedRows === 0) return 0;
    return -unpaintedRows * getCellHeight() * getTotalScale();
  }

  function writeTerminalScreenTransform(offsetY) {
    var screenElement = getTerminalScreenElement();
    if (!screenElement) return;
    var scale = getTotalScale();
    if (!(scale > 0)) scale = 1;
    var visualOffsetY = offsetY + unpaintedRowsOffsetY() + overscrollY;
    if (visualOffsetY === writtenTerminalScreenOffsetY) return;
    writtenTerminalScreenOffsetY = visualOffsetY;
    // Why: the remainder is measured in on-screen px but .xterm-screen sits
    // inside the scaled surface, so divide the scale back out. translate3d on a
    // will-change: transform layer keeps the move on the compositor — no
    // relayout, no xterm repaint, and it survives at the display's refresh rate.
    screenElement.style.transform = 'translate3d(0,' + (visualOffsetY / scale) + 'px,0)';
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

  // Why: apply the finger's delta NOW. Chromium already hands the page one
  // touchmove per display frame, and xterm's own RenderDebouncer folds every
  // scrollLines() of a frame into one repaint, so parking the delta in a second
  // animation frame coalesced nothing — it only added a whole frame of lag on
  // top of the one xterm needs to paint: three frames finger-to-glass at 120 Hz.
  function enqueueNormalBufferScrollDelta(deltaY) {
    if (!term || deltaY === 0) return false;
    if (!applyNormalBufferScrollDelta(deltaY)) return false;
    armSmoothScrollSettle();
    return true;
  }

  function resetSmoothScrollOffset() {
    cancelSmoothScrollSettle();
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
