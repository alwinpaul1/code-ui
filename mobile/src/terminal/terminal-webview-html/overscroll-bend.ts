export const TERMINAL_HTML_OVERSCROLL_BEND = `  // UIScrollView's own resistance curve, f(x, d, c) = x*d*c / (d + c*x) with
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
`
