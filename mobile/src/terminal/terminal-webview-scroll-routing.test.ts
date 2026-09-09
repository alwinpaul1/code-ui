import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readTerminalWebViewHtmlSource } from './terminal-webview-html-source.test-support'

// The in-WebView JS lives in terminal-webview-html.ts; the RN wrapper in
// TerminalWebView.tsx. Concatenate both so assertions resolve regardless of file.
const source =
  readFileSync(new URL('./TerminalWebView.tsx', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-pending-messages.ts', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-url-tap.ts', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-tap-dispatch-injected.ts', import.meta.url), 'utf8') +
  readTerminalWebViewHtmlSource()
const sessionSource = readFileSync(
  new URL('../session/use-mobile-session-terminal-input.ts', import.meta.url),
  'utf8'
)
const sessionHelperSource = readFileSync(
  new URL('../session/mobile-session-route-helpers.ts', import.meta.url),
  'utf8'
)

function sliceBetween(startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endPattern, start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('TerminalWebView scroll routing', () => {
  it('keeps Android touch drags inside the terminal WebView', () => {
    expect(source).toContain('nestedScrollEnabled')
  })

  it('maps a downward pull at the bottom to older scrollback rows', () => {
    expect(source).toContain('var deltaY = ts.lastY - y;')
    expect(source).toContain('smoothScrollOffsetY -= deltaY;')
    expect(source).toContain('var lines = -Math.ceil(smoothScrollOffsetY / effectiveCellH);')

    const nextViewportY = simulateNormalBufferPull({
      baseY: 120,
      viewportY: 120,
      startY: 300,
      endY: 340,
      cellHeight: 20
    })

    expect(nextViewportY).toBe(118)
  })

  it('routes alternate-screen and mouse-aware scroll before smooth normal scroll', () => {
    expect(source).toContain(
      'return isWheelMouseTrackingMode(getMouseTrackingMode()) || isAlternateBufferActive();'
    )

    const touchMoveBlock = sliceBetween(
      "targetSurface.addEventListener('touchmove'",
      '}, { capture: true, passive: false });'
    )
    expect(touchMoveBlock.indexOf('if (shouldRouteScrollToTerminalInput())')).toBeLessThan(
      touchMoveBlock.indexOf('if (enqueueNormalBufferScrollDelta(deltaY))')
    )
    expect(touchMoveBlock).toContain('routeScrollLines(lines, x, y);')

    const momentumBlock = sliceBetween(
      'function momentumStep(frameTime)',
      'if (Math.abs(vel) > MIN_VEL)'
    )
    expect(momentumBlock.indexOf('if (shouldRouteScrollToTerminalInput())')).toBeLessThan(
      momentumBlock.indexOf('if (!applyNormalBufferScrollDelta(delta))')
    )
    expect(momentumBlock).toContain('routeScrollLines(lines, ts.lastX, ts.lastY);')
  })

  it('does not rubber-band normal scroll at scrollback edges', () => {
    expect(source).toContain('function canScrollNormalBufferDelta(deltaY)')
    const smoothScrollBlock = sliceBetween(
      'function applyNormalBufferScrollDelta(deltaY)',
      'function enqueueNormalBufferScrollDelta(deltaY)'
    )
    expect(smoothScrollBlock).toContain('if (!canScrollNormalBufferDelta(deltaY))')
    expect(smoothScrollBlock).toContain('resetSmoothScrollOffset();')
    expect(smoothScrollBlock).toContain('return false;')
    expect(smoothScrollBlock).toContain('return true;')

    const touchMoveBlock = sliceBetween(
      "targetSurface.addEventListener('touchmove'",
      '}, { capture: true, passive: false });'
    )
    expect(touchMoveBlock).toContain('if (enqueueNormalBufferScrollDelta(deltaY))')
    expect(touchMoveBlock).toContain('ts.velY = 0;')

    const momentumBlock = sliceBetween(
      'function momentumStep(frameTime)',
      'if (Math.abs(vel) > MIN_VEL)'
    )
    expect(momentumBlock).toContain('if (!applyNormalBufferScrollDelta(delta))')
    expect(momentumBlock).toContain('ts.momentumId = null;')
  })

  it('coalesces normal touch scroll row commits onto animation frames', () => {
    const enqueueBlock = sliceBetween(
      'function enqueueNormalBufferScrollDelta(deltaY)',
      'function resetSmoothScrollOffset()'
    )
    expect(enqueueBlock).toContain('pendingNormalScrollDeltaY += deltaY;')
    expect(enqueueBlock).toContain('if (normalScrollFrameId !== null) return true;')
    expect(enqueueBlock).toContain('normalScrollFrameId = requestAnimationFrame(function()')
    expect(enqueueBlock).toContain('applyNormalBufferScrollDelta(delta)')

    const resetBlock = sliceBetween(
      'function resetSmoothScrollOffset()',
      'function cellToViewportPx'
    )
    expect(resetBlock).toContain('pendingNormalScrollDeltaY = 0;')
    expect(resetBlock).toContain('cancelAnimationFrame(normalScrollFrameId);')
  })

  it('drains terminal writes without shifting the queued array', () => {
    expect(source).toContain('var writeQueueHead = 0;')
    expect(source).toContain('function nextQueuedWrite()')
    expect(source).toContain('writeQueueHead++;')
    expect(source).toContain('writeQueue = writeQueue.slice(writeQueueHead);')
    expect(source).not.toContain('writeQueue.shift()')
  })

  it('bounds native-side pending WebView writes while preserving control messages', () => {
    expect(source).toContain('const MAX_PENDING_WEB_WRITE_BYTES = 1_000_000')
    expect(source).toContain('const MAX_PENDING_WEB_WRITE_MESSAGES = 4096')
    expect(source).toContain('let pendingWriteBytes = 0')
    expect(source).toContain('let pendingWriteCount = 0')
    expect(source).toContain('const queue = (msg: TerminalWebViewCommand)')
    expect(source).toContain('pendingWriteCount > MAX_PENDING_WEB_WRITE_MESSAGES')
    expect(source).toContain("candidate.type === 'write'")
    expect(source).toContain('pendingMessages.queue(msg)')
    expect(source).toContain('pendingMessages.clear()')
  })

  it('clears WebView await timers when the real response wins', () => {
    const measureBlock = sliceBetween('measureFitDimensions(', 'resetZoom()')
    expect(measureBlock).toContain('clearTimeout(timeout)')
    expect(measureBlock).toContain('measureResolveRef.current === finish')

    const readyBlock = sliceBetween('async awaitReady()', '})')
    expect(readyBlock).toContain('clearTimeout(timeout)')
    expect(readyBlock).toContain('void p.finally')
  })

  it('hides xterm scrollbars and drives the mobile scroll indicator from committed rows', () => {
    expect(source).toContain('<div id="scroll-indicator"><div id="scroll-thumb"></div></div>')
    expect(source).toContain('.xterm .xterm-viewport::-webkit-scrollbar')
    expect(source).toContain('.xterm .xterm-scrollable-element > .xterm-scrollbar')
    expect(source).toContain('overflow-y: hidden !important;')
    expect(source).toContain('display: none !important;')
    expect(source).toContain('function updateScrollIndicator(reveal)')
    expect(source).toContain('buffer.viewportY / maxViewportY')
    expect(source).not.toContain('fractionalRows')
    expect(source).toContain('scrollThumb.style.transform =')
    expect(source).toContain('scheduleScrollIndicatorUpdate(true);')
    // One repaint per frame, not one per committed row from two call sites.
    expect(source).toContain('if (scrollIndicatorFrameId !== null) return;')
    expect(source).toContain('scrollIndicatorFrameId = requestAnimationFrame(function()')
  })

  it('shows the sub-row remainder as a compositor transform, a frame behind the commit', () => {
    // Why: the pan/scale transform on the surface stays exactly as it was. The
    // remainder rides on xterm's own .xterm-screen instead, so pinch, fit and
    // the selection overlay keep reading one unchanged surface transform.
    const updateTransformBlock = sliceBetween(
      'function updateTransform()',
      'function scheduleScrollIndicatorUpdate(reveal)'
    )
    expect(updateTransformBlock).toContain(
      "surface.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + getTotalScale() + ')';"
    )
    expect(updateTransformBlock).not.toContain("getVisualPanY() + 'px) scale('")
    expect(updateTransformBlock).not.toContain('smoothScrollOffsetY')

    const screenTransformBlock = sliceBetween(
      'function getTerminalScreenElement()',
      'function clampNormalScrollLines(lines)'
    )
    expect(screenTransformBlock).toContain("term.element.querySelector('.xterm-screen')")
    expect(screenTransformBlock).toContain(
      "screenElement.style.transform = 'translate3d(0,' + (offsetY / scale) + 'px,0)';"
    )
    // xterm repaints a committed row on ITS next animation frame, so the
    // remainder has to be written on that frame too or every row boundary
    // overshoots by a full row for one frame.
    expect(screenTransformBlock).toContain(
      'pendingTerminalScreenOffsetY = smoothScrollOffsetY;'
    )
    expect(screenTransformBlock).toContain(
      'terminalScreenTransformFrameId = requestAnimationFrame(function()'
    )
    expect(screenTransformBlock).toContain(
      'writeTerminalScreenTransform(pendingTerminalScreenOffsetY);'
    )

    // The selection overlay is positioned outside the surface, so it has to add
    // the same remainder or its handles drift by up to a row during a scroll.
    const cellToViewportBlock = sliceBetween(
      'function cellToViewportPx(col, absRow)',
      'function getLineText(absRow)'
    )
    expect(cellToViewportBlock).toContain(
      'y: sy * total + panY + pendingTerminalScreenOffsetY'
    )

    // The remainder must not survive a new terminal or a re-fit.
    expect(source).toContain('terminalScreenElement = null;')
    expect(source).toContain('pendingTerminalScreenOffsetY = 0;')
    const commitFitBlock = sliceBetween('function commitFitScale(reason, attempts, gate)', 'var cellW = getCellWidth();')
    expect(commitFitBlock).toContain('resetSmoothScrollOffset();')
  })

  it('settles the remainder onto a row boundary when the gesture ends', () => {
    const settleBlock = sliceBetween(
      'function settleSmoothScrollOffset()',
      'function cellToViewportPx(col, absRow)'
    )
    expect(settleBlock).toContain(
      'smoothScrollSettleTargetY = smoothScrollOffsetY <= -effectiveCellH / 2 ? -effectiveCellH : 0;'
    )
    expect(settleBlock).toContain('applyNormalBufferScrollDelta(-step)')

    const touchEndBlock = sliceBetween(
      "targetSurface.addEventListener('touchend'",
      '}, { capture: true, passive: true });'
    )
    expect(touchEndBlock).toContain('settleSmoothScrollOffset();')
  })

  it('flings on the clock, not on the frame counter', () => {
    expect(source).toContain('function updateTouchVelocity(deltaY, dt)')
    // Time-weighted blend: a 120 Hz sample stream must not converge twice as
    // fast, or the same finger launches a different velocity.
    expect(source).toContain(
      'var weight = 1 - Math.pow(1 - VELOCITY_BLEND_WEIGHT, dt / VELOCITY_BLEND_REFERENCE_MS);'
    )
    expect(source).toContain('var VELOCITY_BLEND_WEIGHT = 0.45;')
    expect(source).toContain('var VELOCITY_BLEND_REFERENCE_MS = 1000 / 60;')
    expect(source).toContain('var FRICTION_PER_MS = 0.998297482;')
    expect(source).toContain('var MIN_VEL = 0.012;')
    expect(source).toContain('vel *= Math.pow(FRICTION_PER_MS, elapsed);')
    expect(source).toContain('var delta = vel * elapsed;')
    expect(source).not.toContain('var delta = vel * 16;')
    expect(source).not.toContain('var FRICTION = 0.972;')
    // The per-ms constants are the old 60 Hz behaviour, restated so every other
    // refresh rate matches it instead of diverging from it.
    expect(0.998297482 ** (1000 / 60)).toBeCloseTo(0.972, 5)
    expect(1 - (1 - 0.45) ** ((1000 / 60) / (1000 / 60))).toBeCloseTo(0.45, 10)

    // Date.now() resolves to 1ms, which reads a 120 Hz frame as 8, 9 or 0 —
    // and the 0 used to drop that sample's distance from the estimate.
    expect(source).toContain('var now = nowMs(), dt = now - ts.lastTime;')
    expect(source).not.toContain('var now = Date.now(), dt = now - ts.lastTime;')
  })

  it('reads the scroll layout once per gesture, not once per touchmove', () => {
    const touchMoveBlock = sliceBetween(
      "targetSurface.addEventListener('touchmove'",
      '}, { capture: true, passive: false });'
    )
    expect(touchMoveBlock).toContain('if (ts.canPanX) {')
    expect(touchMoveBlock).not.toContain('term.element.scrollWidth')
    expect(touchMoveBlock).not.toContain('window.innerWidth')

    const touchStartBlock = sliceBetween(
      "targetSurface.addEventListener('touchstart'",
      '}, { capture: true, passive: true });'
    )
    expect(touchStartBlock).toContain('invalidateSurfaceMetrics();')
    expect(touchStartBlock).toContain('ts.canPanX = contentOverflowsViewportWidth();')

    const clampPanBlock = sliceBetween('function clampPan()', 'function adjustRowsForViewport()')
    expect(clampPanBlock).toContain('var metrics = getSurfaceMetrics();')
    expect(clampPanBlock).not.toContain('term.element.scrollWidth')
    expect(clampPanBlock).not.toContain('window.innerHeight')
  })

  it('keeps agent-write bookkeeping off the scrolling frame', () => {
    const observerBlock = sliceBetween(
      'function requestKeyboardAvoidanceMetrics()',
      'function attachTermObservers()'
    )
    expect(observerBlock).toContain('if (isScrollGestureActive()) {')
    expect(observerBlock).toContain('keyboardAvoidanceMetricsDeferred = true;')
    expect(observerBlock).toContain('function flushDeferredKeyboardAvoidanceMetrics()')

    const gateBlock = sliceBetween(
      'function isScrollGestureActive()',
      'function requestKeyboardAvoidanceMetrics()'
    )
    expect(gateBlock).toContain('if (normalScrollFrameId !== null) return true;')
    expect(gateBlock).toContain('if (smoothScrollSettleFrameId !== null) return true;')
    expect(gateBlock).toContain('return !!(ts && ts.momentumId);')

    expect(source).toContain('emitModesIfChanged();\n          requestKeyboardAvoidanceMetrics();')
  })

  it('hands the whole touch stream to the injected handlers', () => {
    // Why: with no touch-action the Android compositor runs its own scroll and
    // zoom detection before the page sees a touchmove, which is latency the
    // gesture cannot get back.
    expect(source).toContain('touch-action: none;')
    expect(source).toContain('overscroll-behavior: none;')
    const surfaceCss = sliceBetween('#terminal-surface {', '}')
    expect(surfaceCss).toContain('will-change: transform;')
    const screenCss = sliceBetween('.xterm .xterm-screen {', '}')
    expect(screenCss).toContain('will-change: transform;')
    expect(source).toContain('overScrollMode="never"')
    expect(source).toContain('androidLayerType="hardware"')
  })

  it('keeps selection edge autoscroll active and extends the dragged endpoint', () => {
    const startBlock = sliceBetween('function startEdgeScroll(dir)', 'function stopEdgeScroll()')
    expect(startBlock.indexOf('stopEdgeScroll();')).toBeLessThan(
      startBlock.indexOf('edgeScrollDir = dir;')
    )
    expect(startBlock.indexOf('term.scrollLines(edgeScrollDir);')).toBeLessThan(
      startBlock.indexOf('syncEdgeScrollSelectionEndpoint();')
    )

    const dragMoveBlock = sliceBetween(
      'function handleDragMove(handle, clientX, clientY)',
      '  // Latching document-level touch dispatcher: see'
    )
    expect(dragMoveBlock).toContain('edgeScrollClientX = clientX;')
    expect(dragMoveBlock).toContain('edgeScrollClientY = clientY;')
    expect(dragMoveBlock).toContain('syncSelectionHandleToViewportPoint(handle, clientX, clientY)')
  })

  it('opens links and paths from surface taps before mouse/focus fallback', () => {
    expect(source).toContain('function buildMouseClickInput(clientX, clientY)')
    expect(source).toContain('function isClickMouseTrackingMode(mode)')
    expect(source).toContain("return mode !== 'none';")
    expect(source).toContain('var pixelX = cell.x;')
    expect(source).toContain('var pixelY = cell.y;')
    expect(source).toContain(
      'if (!isSafeSgrMouseCoordinate(cell.x) || !isSafeSgrMouseCoordinate(cell.y)) return'
    )
    expect(source).toContain(
      'if (!isSafeSgrMouseCoordinate(sgrCol) || !isSafeSgrMouseCoordinate(sgrRow)) return'
    )
    expect(source).toContain("if (mouseTrackingMode === 'x10') return pixelPress;")
    expect(source).toContain("if (mouseTrackingMode === 'x10') return sgrPress;")
    expect(source).toContain("if (mouseTrackingMode === 'x10') return press;")
    expect(source).toContain("if (col > 126 || row > 126) return '';")

    const touchEndBlock = sliceBetween(
      "document.addEventListener('touchend'",
      '}, { capture: true, passive: true });'
    )
    expect(touchEndBlock).toContain(
      'notifyTerminalSurfaceTap(tapCandidate.x, tapCandidate.y, true)'
    )

    const tapHandlerBlock = sliceBetween(
      'function notifyTerminalSurfaceTap(originX, originY, focusKeyboard)',
      "document.addEventListener('touchstart'"
    )
    expect(tapHandlerBlock.indexOf('oscLinkAtViewportPoint')).toBeLessThan(
      tapHandlerBlock.indexOf('urlAtViewportPoint')
    )
    expect(tapHandlerBlock.indexOf('urlAtViewportPoint')).toBeLessThan(
      tapHandlerBlock.indexOf('filePathAtViewportPoint')
    )
    expect(tapHandlerBlock.indexOf('filePathAtViewportPoint')).toBeLessThan(
      tapHandlerBlock.indexOf('var clickInput = buildMouseClickInput')
    )
    expect(tapHandlerBlock).toContain("notify({ type: 'open-url', url: tappedUrl });")
    expect(tapHandlerBlock).toContain("notify({ type: 'terminal-input', bytes: clickInput });")
    expect(tapHandlerBlock).toContain(
      'if (focusKeyboard || !isClickMouseTrackingMode(getMouseTrackingMode()))'
    )
    expect(tapHandlerBlock).toContain("notify({ type: 'terminal-tap' });")
  })

  it('allows x10 mouse gesture reports through the mobile session gate', () => {
    expect(sessionHelperSource).toContain('function isGestureMouseTrackingMode')
    expect(sessionHelperSource).toContain(
      "return mode === 'x10' || mode === 'vt200' || mode === 'drag' || mode === 'any'"
    )

    const inputBlockStart = sessionSource.indexOf('const handleTerminalInput = useCallback')
    expect(inputBlockStart).toBeGreaterThanOrEqual(0)
    const inputBlockEnd = sessionSource.indexOf(
      'async function handleClearTerminal',
      inputBlockStart
    )
    expect(inputBlockEnd).toBeGreaterThan(inputBlockStart)
    const inputBlock = sessionSource.slice(inputBlockStart, inputBlockEnd)
    expect(inputBlock).toContain('!isGestureMouseTrackingMode(modes?.mouseTrackingMode)')
    expect(inputBlock).toContain('const sequenceCount = countTerminalGestureInputSequences(bytes)')
    expect(inputBlock.indexOf('countTerminalGestureInputSequences')).toBeLessThan(
      inputBlock.indexOf('enqueueTerminalGestureInput')
    )
  })
})

function simulateNormalBufferPull({
  baseY,
  viewportY,
  startY,
  endY,
  cellHeight
}: {
  baseY: number
  viewportY: number
  startY: number
  endY: number
  cellHeight: number
}): number {
  const deltaY = startY - endY
  if (deltaY > 0 ? viewportY >= baseY : viewportY <= 0) {
    return viewportY
  }
  const smoothScrollOffsetY = -deltaY
  // Why: ceil, not trunc — the row commits as soon as the finger crosses into
  // it, so the leftover remainder is always negative (content pulled UP).
  const lines = -Math.ceil(smoothScrollOffsetY / cellHeight)
  const applied = Math.max(lines, -viewportY)
  return viewportY + applied
}
