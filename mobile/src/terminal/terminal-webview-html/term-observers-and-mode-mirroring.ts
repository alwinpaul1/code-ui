import { TERMINAL_KEYBOARD_AVOIDANCE_METRICS_JS } from '../terminal-keyboard-avoidance-metrics-injected'

export const TERMINAL_HTML_OBSERVERS_AND_MODE_MIRRORING = `  function emitModesIfChanged() {
    if (!term) return;
    var bp = !!(term.modes && term.modes.bracketedPasteMode);
    var alt = false;
    var mouseTrackingMode = getMouseTrackingMode();
    try { alt = term.buffer && term.buffer.active && term.buffer.active.type === 'alternate'; } catch (e) {}
    if (
      bp !== lastEmittedModes.bracketedPasteMode ||
      alt !== lastEmittedModes.altScreen ||
      mouseTrackingMode !== lastEmittedModes.mouseTrackingMode ||
      sgrMouseMode !== lastEmittedModes.sgrMouseMode ||
      sgrMousePixelsMode !== lastEmittedModes.sgrMousePixelsMode
    ) {
      lastEmittedModes = {
        bracketedPasteMode: bp,
        altScreen: alt,
        mouseTrackingMode: mouseTrackingMode,
        sgrMouseMode: sgrMouseMode,
        sgrMousePixelsMode: sgrMousePixelsMode
      };
      notify({
        type: 'modes',
        bracketedPasteMode: bp,
        altScreen: alt,
        mouseTrackingMode: mouseTrackingMode,
        sgrMouseMode: sgrMouseMode,
        sgrMousePixelsMode: sgrMousePixelsMode
      });
    }
  }
  var lastEmittedModes = {
    bracketedPasteMode: false,
    altScreen: false,
    mouseTrackingMode: 'none',
    sgrMouseMode: false,
    sgrMousePixelsMode: false
  };

  ${TERMINAL_KEYBOARD_AVOIDANCE_METRICS_JS}

  var keyboardAvoidanceMetricsDeferred = false;

  function isScrollGestureActive() {
    if (smoothScrollSettleFrameId !== null) return true;
    return !!(ts && (ts.dragging || ts.momentumId));
  }

  // Why: emitKeyboardAvoidanceMetrics walks rows x cols cells and serializes a
  // JSON postMessage, and onWriteParsed fires it on EVERY parsed write. A busy
  // agent therefore lands that work on the same main thread as the frame a
  // 120 Hz scroll is trying to hit. Hold it while the gesture, fling or settle
  // is live and emit once at the end — the keyboard cannot open mid-scroll.
  function requestKeyboardAvoidanceMetrics() {
    if (isScrollGestureActive()) {
      keyboardAvoidanceMetricsDeferred = true;
      return;
    }
    emitKeyboardAvoidanceMetrics();
  }

  function flushDeferredKeyboardAvoidanceMetrics() {
    if (!keyboardAvoidanceMetricsDeferred) return;
    keyboardAvoidanceMetricsDeferred = false;
    emitKeyboardAvoidanceMetrics();
  }

  function attachTermObservers() {
    if (!term) return;
    disposeTermObservers();
    try { termObserverDisposables.push(term.onLineFeed(logFeedAndEvict)); } catch (e) {}
    try {
      termObserverDisposables.push(term.onScroll(function() { scheduleScrollIndicatorUpdate(false); }));
    } catch (e) {}
    // Why: the frame xterm actually paints a scrolled row is the only frame the
    // sub-row remainder may change on. See syncTerminalScreenTransformToRender.
    try {
      if (term.onRender) termObserverDisposables.push(term.onRender(syncTerminalScreenTransformToRender));
    } catch (e) {}
    // Why: emit modes on every parsed write so RN's mirror stays current
    // without round-trip; covers \\x1b[?2004h/l and alt-screen toggles.
    try {
      if (term.onWriteParsed) {
        termObserverDisposables.push(term.onWriteParsed(function() {
          emitModesIfChanged();
          requestKeyboardAvoidanceMetrics();
        }));
      }
    } catch (e) {}
    // Initial emit once buffer settles.
    afterWritesDrained(function() {
      emitModesIfChanged();
      emitKeyboardAvoidanceMetrics();
    });
  }

`
