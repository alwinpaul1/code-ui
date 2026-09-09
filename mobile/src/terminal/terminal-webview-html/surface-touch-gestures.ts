import { TERMINAL_TAP_DISPATCH_JS } from '../terminal-webview-tap-dispatch-injected'
import { TERMINAL_WHEEL_SCROLL_JS } from '../terminal-webview-wheel-scroll-injected'
import { TERMINAL_MOUSE_CLICK_DRAG_JS } from '../terminal-webview-mouse-click-drag-injected'

// Also wires the selection menu's Copy/Select All buttons, which sit here in the emitted document.
export const TERMINAL_HTML_SURFACE_TOUCH_GESTURES = `  ${TERMINAL_TAP_DISPATCH_JS}

  // External mouse / trackpad scroll: see
  // terminal-webview-wheel-scroll-injected.ts (extracted for max-lines).
  ${TERMINAL_WHEEL_SCROLL_JS}

  // External mouse click/drag: see
  // terminal-webview-mouse-click-drag-injected.ts (extracted for max-lines).
  ${TERMINAL_MOUSE_CLICK_DRAG_JS}

  btnCopy.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!term) return;
    var text = term.getSelection ? term.getSelection() : '';
    if (text && text.length > 0) {
      notify({ type: 'selection', text: text });
    } else {
      cancelSelect();
    }
  });

  btnSelAll.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!term) return;
    try {
      term.selectAll();
      var b = term.buffer.active;
      sel = {
        anchor: { col: 0, row: 0 },
        focus: { col: term.cols - 1, row: b.length - 1 },
        activeHandle: null
      };
      repositionOverlay();
    } catch (err) {}
  });

  var ts = {
    lastX: 0, lastY: 0, lastTime: 0, velY: 0,
    accumDelta: 0, momentumId: null, isPinching: false, canPanX: false,
    pinchDist: 0, pinchScale: 0, pinchSurfX: 0, pinchSurfY: 0
  };

  // Why: every scroll constant below is per MILLISECOND, not per frame. The old
  // per-frame friction and fixed 16ms step made a fling travel twice as far on a
  // 120 Hz phone as on a 60 Hz one. VELOCITY_BLEND_WEIGHT and FRICTION_PER_MS
  // are the old 0.45 blend and 0.972 friction expressed over a 60 Hz frame, so
  // 60 Hz behaviour is unchanged and every other refresh rate now matches it.
  var VELOCITY_BLEND_REFERENCE_MS = 1000 / 60;
  var VELOCITY_BLEND_WEIGHT = 0.45;
  var FRICTION_PER_MS = 0.998297482;
  var MIN_VEL = 0.012;

  function updateTouchVelocity(deltaY, dt) {
    if (!(dt > 0)) return;
    var instantVelocity = deltaY / dt;
    if (!isFinite(instantVelocity)) return;
    if (ts.velY === 0) {
      ts.velY = instantVelocity;
      return;
    }
    // Why: touchmove cadence is uneven in WebView. Blend recent samples so
    // momentum launch doesn't inherit a one-frame spike or stall — weighted by
    // elapsed TIME, because a per-sample weight lets a 120 Hz stream converge
    // twice as fast and launch a different velocity from the same finger.
    var weight = 1 - Math.pow(1 - VELOCITY_BLEND_WEIGHT, dt / VELOCITY_BLEND_REFERENCE_MS);
    ts.velY = ts.velY * (1 - weight) + instantVelocity * weight;
  }

  function getDistance(a, b) {
    var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function attachSurfaceEventHandlers(targetSurface) {
    if (!targetSurface || targetSurface.__orcaSurfaceHandlersAttached) return;
    targetSurface.__orcaSurfaceHandlersAttached = true;
    // Why: init() swaps in a new hidden surface to avoid flicker; each
    // replacement needs gesture handlers or tab-switch replays stop scrolling.
    targetSurface.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); }, true);
    targetSurface.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); }, true);

    attachSurfaceWheelHandler(targetSurface);
    attachSurfaceMouseClickDragHandler(targetSurface);

    targetSurface.addEventListener('touchstart', function(e) {
      if (dispatcherShouldBlockSurface()) return;
      if (ts.momentumId) {
        cancelAnimationFrame(ts.momentumId);
        ts.momentumId = null;
      }
      cancelSmoothScrollSettle();
      // Why: the finger owns the content from here, so stop any settle in
      // flight — but re-arm it on the idle timer. Catching a fling and then
      // holding still would otherwise leave the content off the row grid, and
      // a long press (500ms) resolves the cell under the finger from the grid.
      if (smoothScrollOffsetY !== 0) armSmoothScrollSettle();
      // Why: content width, content height and the window box cannot change
      // while a finger is down, so this is the one place per gesture that pays
      // for a layout read; every touchmove then reads the cache.
      invalidateSurfaceMetrics();
      ts.canPanX = contentOverflowsViewportWidth();
      if (e.touches.length === 2) {
        ts.isPinching = true;
        resetSmoothScrollOffset();
        ts.pinchDist = getDistance(e.touches[0], e.touches[1]);
        ts.pinchScale = userScale;
        var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        var total = getTotalScale();
        ts.pinchSurfX = (mx - panX) / total;
        ts.pinchSurfY = (my - panY) / total;
      } else if (e.touches.length === 1) {
        ts.isPinching = false;
        ts.lastX = e.touches[0].clientX;
        ts.lastY = e.touches[0].clientY;
        ts.lastTime = nowMs();
        ts.velY = 0;
        ts.accumDelta = 0;
      }
    }, { capture: true, passive: true });

    targetSurface.addEventListener('touchmove', function(e) {
      if (dispatcherShouldBlockSurface()) return;
      if (!term) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.touches.length === 2) {
        ts.isPinching = true;
        var dist = getDistance(e.touches[0], e.touches[1]);
        var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;

        var ratio = dist / ts.pinchDist;
        // Why: userScale is a CSS multiplier on the current font size; bound it so
        // the resulting apparent size (currentTextScale × userScale) stays within
        // the preset range, since release snaps to one of those presets.
        var loScale = MIN_TEXT_SCALE / currentTextScale;
        var hiScale = MAX_TEXT_SCALE / currentTextScale;
        userScale = Math.max(loScale, Math.min(hiScale, ts.pinchScale * ratio));

        var total = getTotalScale();
        panX = mx - ts.pinchSurfX * total;
        panY = my - ts.pinchSurfY * total;
        clampPan();
        updateTransform();

      } else if (e.touches.length === 1 && !ts.isPinching) {
        var x = e.touches[0].clientX, y = e.touches[0].clientY;
        var now = nowMs(), dt = now - ts.lastTime;

        // Why: pan horizontally only when content overflows the viewport (larger
        // than fit) — same check clampPan() uses, decided once at touchstart.
        // Vertical always drives buffer scroll so scrollback stays reachable at
        // any text size; calling the never-defined contentWiderThanViewport()
        // here threw and killed all single-finger scrolling, scrollback included.
        if (ts.canPanX) {
          panX += x - ts.lastX;
          clampPan();
          updateTransform();
        }

        var deltaY = ts.lastY - y;
        ts.lastTime = now;
        if (shouldRouteScrollToTerminalInput()) {
          updateTouchVelocity(deltaY, dt);
          resetSmoothScrollOffset();
          var effectiveCellH = getCellHeight() * getTotalScale();
          ts.accumDelta += deltaY;
          var lines = Math.trunc(ts.accumDelta / effectiveCellH);
          if (lines !== 0) {
            ts.accumDelta -= lines * effectiveCellH;
            routeScrollLines(lines, x, y);
          }
        } else {
          if (enqueueNormalBufferScrollDelta(deltaY)) {
            updateTouchVelocity(deltaY, dt);
          } else {
            ts.velY = 0;
          }
        }
        ts.lastX = x;
        ts.lastY = y;
      }
    }, { capture: true, passive: false });

    targetSurface.addEventListener('touchend', function(e) {
      if (dispatcherShouldBlockSurface()) return;
      if (!term) return;

      if (ts.isPinching && e.touches.length < 2) {
        ts.isPinching = false;
        // Why: a finished pinch snaps to the nearest preset and becomes the new
        // font size (reflowing the grid), so pinch-to-zoom IS the in-terminal way
        // to set the text size. The CSS pinch zoom (userScale) is reset; the real
        // size change reflows columns and RN persists + resizes the PTY to match.
        var target = snapToTextScalePreset(currentTextScale * userScale);
        var changed = target !== currentTextScale;
        userScale = 1;
        panX = 0; panY = 0;
        applyTextScale(target);
        updateTransform();
        notify({ type: 'font-scale-changed', fontScale: target });
        if (changed) notify({ type: 'haptic', kind: 'selection' });
        if (e.touches.length === 1) {
          // Why: the pinch changed the scale, so the pan decision taken at
          // touchstart no longer holds for the finger that is still down.
          ts.canPanX = contentOverflowsViewportWidth();
          ts.lastX = e.touches[0].clientX;
          ts.lastY = e.touches[0].clientY;
          ts.lastTime = nowMs();
          ts.velY = 0;
          ts.accumDelta = 0;
        }
        return;
      }

      if (e.touches.length === 0) {
        var vel = ts.velY;
        var momentumTime = 0;
        function momentumStep(frameTime) {
          var now = typeof frameTime === 'number' ? frameTime : nowMs();
          if (momentumTime === 0) momentumTime = now - VELOCITY_BLEND_REFERENCE_MS;
          var elapsed = now - momentumTime;
          momentumTime = now;
          if (elapsed <= 0) elapsed = 1;
          // Why: a dropped frame must not teleport the content a screenful.
          if (elapsed > SMOOTH_SCROLL_MAX_STEP_MS) elapsed = SMOOTH_SCROLL_MAX_STEP_MS;
          vel *= Math.pow(FRICTION_PER_MS, elapsed);
          if (Math.abs(vel) < MIN_VEL) {
            ts.momentumId = null;
            settleSmoothScrollOffset();
            return;
          }
          var delta = vel * elapsed;
          if (shouldRouteScrollToTerminalInput()) {
            resetSmoothScrollOffset();
            var effectiveCellH = getCellHeight() * getTotalScale();
            ts.accumDelta += delta;
            var lines = Math.trunc(ts.accumDelta / effectiveCellH);
            if (lines !== 0) {
              ts.accumDelta -= lines * effectiveCellH;
              routeScrollLines(lines, ts.lastX, ts.lastY);
            }
          } else {
            if (!applyNormalBufferScrollDelta(delta)) {
              ts.momentumId = null;
              settleSmoothScrollOffset();
              return;
            }
          }
          ts.momentumId = requestAnimationFrame(momentumStep);
        }
        if (Math.abs(vel) > MIN_VEL) {
          cancelSmoothScrollSettle();
          ts.momentumId = requestAnimationFrame(momentumStep);
        } else {
          settleSmoothScrollOffset();
        }
      }
    }, { capture: true, passive: true });
  }

  attachSurfaceEventHandlers(surface);

`
