import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  documentModuleSource,
  webviewPageSource
} from './document/document-module-source.test-support'
import { XTERM_ENGINE_CSS } from './terminal-webview-engine-css.generated'
import { XTERM_HTML } from './terminal-webview-html'

const DOCUMENT_SOURCE = webviewPageSource()

// The RN wrapper and the pending-message queue are TypeScript; everything the WebView runs is the
// generated document. Concatenated so assertions resolve regardless of file.
const source =
  readFileSync(new URL('./TerminalWebView.tsx', import.meta.url), 'utf8') +
  readFileSync(new URL('./use-terminal-webview-controller.ts', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-ready-promises.ts', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-pending-messages.ts', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-html/document-markup.ts', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-html/document-style.ts', import.meta.url), 'utf8') +
  DOCUMENT_SOURCE
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
    expect(source).toContain('const deltaY = scope.touchGesture.lastY - y')
    expect(source).toContain('scope.smoothScrollOffsetY -= deltaY')
    // Code UI: ceil, not trunc — the row commits as soon as the finger crosses into it.
    expect(source).toContain('const lines = -Math.ceil(scope.smoothScrollOffsetY / effectiveCellH)')

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
      'return isWheelMouseTrackingMode(getMouseTrackingMode(scope)) || isAlternateBufferActive(scope)'
    )

    const touchMoveBlock = sliceBetween(
      "targetSurface.addEventListener(\n    'touchmove'",
      '{ capture: true, passive: false }'
    )
    expect(touchMoveBlock.indexOf('if (shouldRouteScrollToTerminalInput(scope))')).toBeLessThan(
      touchMoveBlock.indexOf('if (enqueueNormalBufferScrollDelta(scope, deltaY))')
    )
    expect(touchMoveBlock).toContain('routeScrollLines(scope, lines, x, y)')

    const momentumBlock = sliceBetween(
      'function momentumStep(frameTime?: number) {',
      'if (Math.abs(vel) > MIN_VEL)'
    )
    expect(momentumBlock.indexOf('if (shouldRouteScrollToTerminalInput(scope))')).toBeLessThan(
      momentumBlock.indexOf('if (!applyNormalBufferScrollDelta(scope, delta))')
    )
    expect(momentumBlock).toContain(
      'routeScrollLines(scope, lines, scope.touchGesture.lastX, scope.touchGesture.lastY)'
    )
  })

  it('does not rubber-band normal scroll at scrollback edges', () => {
    expect(source).toContain('export function canScrollNormalBufferDelta(')
    const smoothScrollBlock = sliceBetween(
      'export function applyNormalBufferScrollDelta(',
      'export function enqueueNormalBufferScrollDelta('
    )
    expect(smoothScrollBlock).toContain('if (!canScrollNormalBufferDelta(scope, deltaY))')
    expect(smoothScrollBlock).toContain('resetSmoothScrollOffset(scope)')
    expect(smoothScrollBlock).toContain('return false')
    expect(smoothScrollBlock).toContain('return true')

    const touchMoveBlock = sliceBetween(
      "targetSurface.addEventListener(\n    'touchmove'",
      '{ capture: true, passive: false }'
    )
    expect(touchMoveBlock).toContain('if (enqueueNormalBufferScrollDelta(scope, deltaY))')
    expect(touchMoveBlock).toContain('scope.touchGesture.velY = 0')

    const momentumBlock = sliceBetween(
      'function momentumStep(frameTime?: number) {',
      'if (Math.abs(vel) > MIN_VEL)'
    )
    expect(momentumBlock).toContain('if (!applyNormalBufferScrollDelta(scope, delta))')
    expect(momentumBlock).toContain('scope.touchGesture.momentumId = null')
  })

  it('applies a touchmove to the buffer in the frame it arrives, not a frame later', () => {
    // Code UI: Chromium already delivers one touchmove per display frame and xterm
    // folds every scrollLines() of a frame into one repaint, so a second
    // animation frame in between coalesced nothing and cost a frame of lag.
    const enqueueBlock = sliceBetween(
      'export function enqueueNormalBufferScrollDelta(',
      'export function resetSmoothScrollOffset('
    )
    expect(enqueueBlock).toContain(
      'if (!applyNormalBufferScrollDelta(scope, deltaY)) {\n    return false'
    )
    expect(enqueueBlock).toContain('armSmoothScrollSettle(scope)')
    expect(enqueueBlock).not.toContain('requestAnimationFrame')
    expect(enqueueBlock).not.toContain('scheduleDocumentFrame')
    expect(DOCUMENT_SOURCE).not.toContain('normalScrollFrameId')
    expect(DOCUMENT_SOURCE).not.toContain('pendingNormalScrollDeltaY')
  })

  it('drains terminal writes without shifting the queued array', () => {
    expect(source).toContain('scope.writeQueueHead = 0')
    expect(source).toContain('export function nextQueuedWrite(')
    expect(source).toContain('scope.writeQueueHead++')
    expect(source).toContain('scope.writeQueue = scope.writeQueue.slice(scope.writeQueueHead)')
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
    // C7.5 moved both promises into `terminal-webview-ready-promises.ts`, which both components
    // reach through the controller; the two blocks are the same code in their new home.
    const measureBlock = sliceBetween('function measure(', 'function resolveMeasure')
    expect(measureBlock).toContain('clearTimeout(timeout)')
    expect(measureBlock).toContain('measureResolve === finish')

    const readyBlock = sliceBetween('async function awaitReady()', 'function measure(')
    expect(readyBlock).toContain('clearTimeout(timeout)')
    expect(readyBlock).toContain('void pending.finally')
  })

  it('hides xterm scrollbars and drives the mobile scroll indicator from committed rows', () => {
    expect(source).toContain('<div id="scroll-indicator"><div id="scroll-thumb"></div></div>')
    expect(source).toContain('.xterm .xterm-viewport::-webkit-scrollbar')
    expect(source).toContain('.xterm .xterm-scrollable-element > .xterm-scrollbar')
    expect(source).toContain('overflow-y: hidden !important')
    expect(source).toContain('display: none !important')
    expect(source).toContain('export function updateScrollIndicator(')
    expect(source).toContain('buffer.viewportY / maxViewportY')
    expect(source).not.toContain('fractionalRows')
    expect(source).toContain('scrollThumb.style.transform =')
    // Code UI: one repaint per frame, not one per committed row from two call sites.
    expect(source).toContain('scheduleScrollIndicatorUpdate(scope, true)')
    expect(source).toContain('if (scope.scrollIndicatorFrameId !== null) {\n    return')
    expect(source).toContain(
      'scope.scrollIndicatorFrameId = scheduleDocumentFrame(scope, function () {'
    )
  })

  it('shows the sub-row remainder as a compositor transform, a frame behind the commit', () => {
    // Code UI: the pan/scale transform on the surface stays exactly as it was. The
    // remainder rides on xterm's own .xterm-screen instead, so pinch, fit and
    // the selection overlay keep reading one unchanged surface transform.
    const updateTransformBlock = sliceBetween(
      'export function updateTransform(',
      'export function scheduleScrollIndicatorUpdate('
    )
    expect(updateTransformBlock).toContain(
      "'translate(' + scope.panX + 'px,' + scope.panY + 'px) scale(' + getTotalScale(scope) + ')'"
    )
    expect(updateTransformBlock).not.toContain('getVisualPanY() + "px) scale("')
    expect(updateTransformBlock).not.toContain('smoothScrollOffsetY')

    const screenTransformBlock = sliceBetween(
      'export function getTerminalScreenElement(',
      'export function clampNormalScrollLines('
    )
    expect(screenTransformBlock).toContain(
      "scope.term.element.querySelector<HTMLElement>('.xterm-screen')"
    )
    expect(screenTransformBlock).toContain(
      "screenElement.style.transform = 'translate3d(0,' + visualOffsetY / scale + 'px,0)'"
    )
    // xterm repaints a committed row on ITS next animation frame, so the
    // remainder has to be written on that frame too or every row boundary
    // overshoots by a full row for one frame.
    expect(screenTransformBlock).toContain(
      'scope.pendingTerminalScreenOffsetY = scope.smoothScrollOffsetY'
    )
    expect(screenTransformBlock).toContain(
      'scope.terminalScreenTransformFrameId = scheduleDocumentFrame(scope, function () {'
    )
    expect(screenTransformBlock).toContain(
      'writeTerminalScreenTransform(scope, scope.pendingTerminalScreenOffsetY)'
    )
    // The frame is only a prediction: a write the agent streamed in the same
    // frame has already booked xterm's paint, and synchronized output can park
    // it for far longer. term.onRender is the truth, so the transform is
    // rewritten there, and rows the paint has not caught up with ride on it.
    expect(screenTransformBlock).toContain('export function syncTerminalScreenTransformToRender(')
    expect(screenTransformBlock).toContain(
      'scope.renderedViewportY = scope.term.buffer.active.viewportY'
    )
    expect(screenTransformBlock).toContain(
      'const visualOffsetY = offsetY + unpaintedRowsOffsetY(scope) + scope.overscrollY'
    )
    expect(screenTransformBlock).toContain(
      'if (scope.term.buffer.active.type !== scope.renderedBufferType) {\n    return 0'
    )
    expect(source).toContain(
      'scope.term.onRender(() => syncTerminalScreenTransformToRender(scope))'
    )

    // The selection overlay is positioned outside the surface, so it has to add
    // the same remainder or its handles drift by up to a row during a scroll.
    expect(documentModuleSource('cell-geometry')).toContain(
      'y: sy * total + scope.panY + scope.pendingTerminalScreenOffsetY'
    )

    // The remainder must not survive a new terminal or a re-fit.
    expect(source).toContain('scope.terminalScreenElement = null')
    expect(source).toContain('scope.pendingTerminalScreenOffsetY = 0')
    const commitFitBlock = sliceBetween(
      'export function commitFitScale(',
      'const cellW = getCellWidth(scope)'
    )
    expect(commitFitBlock).toContain('resetSmoothScrollOffset(scope)')
  })

  it('settles the remainder onto a row boundary when the gesture ends', () => {
    const settleBlock = sliceBetween(
      'export function settleSmoothScrollOffset(',
      'export function smoothScrollSettleStep('
    )
    expect(settleBlock).toContain(
      'scope.smoothScrollOffsetY <= -effectiveCellH / 2 ? -effectiveCellH : 0'
    )
    expect(documentModuleSource('normal-buffer-smooth-scroll')).toContain(
      'applyNormalBufferScrollDelta(scope, -step)'
    )

    const touchEndBlock = sliceBetween(
      "targetSurface.addEventListener(\n    'touchend'",
      '{ capture: true, passive: true }'
    )
    expect(touchEndBlock).toContain('settleSmoothScrollOffset(scope)')
  })

  it('flings on the clock, not on the frame counter', () => {
    // Code UI: #21687's per-ms decay was already this fork's (7097feea); the constants below are
    // the fork's, which upstream's differ from.
    expect(source).toContain('export function updateTouchVelocity(')
    // Time-weighted blend: a 120 Hz sample stream must not converge twice as
    // fast, or the same finger launches a different velocity.
    expect(source).toContain(
      'const weight = 1 - Math.pow(1 - VELOCITY_BLEND_WEIGHT, dt / VELOCITY_BLEND_REFERENCE_MS)'
    )
    expect(source).toContain('const VELOCITY_BLEND_WEIGHT = 0.45')
    expect(source).toContain('const VELOCITY_BLEND_REFERENCE_MS = 1000 / 60')
    expect(source).toContain('const FRICTION_PER_MS = 0.998297482')
    expect(source).toContain('const MIN_VEL = 0.012')
    expect(source).toContain('vel *= Math.pow(FRICTION_PER_MS, elapsed)')
    expect(source).toContain('const delta = vel * elapsed')
    expect(source).not.toContain('vel * 16')
    expect(source).not.toContain('FRICTION = 0.972')
    // The per-ms constants are the old 60 Hz behaviour, restated so every other
    // refresh rate matches it instead of diverging from it.
    expect(0.998297482 ** (1000 / 60)).toBeCloseTo(0.972, 5)
    expect(1 - (1 - 0.45) ** (1000 / 60 / (1000 / 60))).toBeCloseTo(0.45, 10)

    // Date.now() resolves to 1ms, which reads a 120 Hz frame as 8, 9 or 0 —
    // and the 0 used to drop that sample's distance from the estimate.
    expect(source).toContain(
      'const now = nowMs(),\n          dt = now - scope.touchGesture.lastTime'
    )
    expect(source).not.toContain('Date.now(),\n          dt = now - scope.touchGesture.lastTime')
  })

  it('reads the scroll layout once per gesture, not once per touchmove', () => {
    const touchMoveBlock = sliceBetween(
      "targetSurface.addEventListener(\n    'touchmove'",
      '{ capture: true, passive: false }'
    )
    expect(touchMoveBlock).toContain('if (scope.touchGesture.canPanX) {')
    expect(touchMoveBlock).not.toContain('term.element.scrollWidth')
    expect(touchMoveBlock).not.toContain('window.innerWidth')

    const touchStartBlock = sliceBetween(
      "targetSurface.addEventListener(\n    'touchstart'",
      '{ capture: true, passive: true }'
    )
    expect(touchStartBlock).toContain('invalidateSurfaceMetrics(scope)')
    expect(touchStartBlock).toContain(
      'scope.touchGesture.canPanX = contentOverflowsViewportWidth(scope)'
    )

    const clampPanBlock = sliceBetween(
      'export function clampPan(',
      'export function adjustRowsForViewport('
    )
    expect(clampPanBlock).toContain('const metrics = getSurfaceMetrics(scope)')
    expect(clampPanBlock).not.toContain('term.element.scrollWidth')
    expect(clampPanBlock).not.toContain('window.innerHeight')
  })

  it('keeps agent-write bookkeeping off the scrolling frame', () => {
    const metrics = documentModuleSource('keyboard-avoidance-metrics')
    const observerBlock = metrics.slice(
      metrics.indexOf('export function requestKeyboardAvoidanceMetrics(')
    )
    expect(observerBlock).toContain('if (isScrollGestureActive(scope)) {')
    expect(observerBlock).toContain('scope.keyboardAvoidanceMetricsDeferred = true')
    expect(observerBlock).toContain('export function flushDeferredKeyboardAvoidanceMetrics(')

    const gateBlock = metrics.slice(
      metrics.indexOf('export function isScrollGestureActive('),
      metrics.indexOf('export function requestKeyboardAvoidanceMetrics(')
    )
    expect(gateBlock).toContain('if (scope.smoothScrollSettleFrameId !== null) {\n    return true')
    expect(gateBlock).toContain(
      'return !!(scope.touchGesture && (scope.touchGesture.dragging || scope.touchGesture.momentumId))'
    )
    // Why: the finger owns the frame from touchstart to touchend, whether or
    // not a scroll frame happens to be pending.
    expect(source).toContain('scope.touchGesture.dragging = true')
    expect(source).toContain('scope.touchGesture.dragging = false')

    expect(documentModuleSource('term-observers')).toContain(
      'emitModesIfChanged(scope)\n          requestKeyboardAvoidanceMetrics(scope)'
    )
  })

  it('hands the whole touch stream to the injected handlers', () => {
    // Code UI: with no touch-action the Android compositor runs its own scroll and
    // zoom detection before the page sees a touchmove, which is latency the
    // gesture cannot get back.
    expect(source).toContain('touch-action: none;')
    expect(source).toContain('overscroll-behavior: none;')
    const surfaceCss = sliceBetween('#terminal-surface {', '}')
    expect(surfaceCss).toContain('will-change: transform;')
    // Why: the document inlines the engine's stylesheet ahead of its own, and the engine has a
    // `.xterm .xterm-screen` rule too, so read the rule from the document's stylesheet after it.
    const documentCss = XTERM_HTML.slice(
      XTERM_HTML.indexOf(XTERM_ENGINE_CSS) + XTERM_ENGINE_CSS.length
    )
    const screenCssStart = documentCss.indexOf('.xterm .xterm-screen {')
    expect(screenCssStart).toBeGreaterThanOrEqual(0)
    const screenCss = documentCss.slice(screenCssStart, documentCss.indexOf('}', screenCssStart))
    expect(screenCss).toContain('will-change: transform;')
    expect(source).toContain('overScrollMode="never"')
    // Why: LAYER_TYPE_HARDWARE makes the framework redraw the WebView's whole
    // offscreen texture on every content change; Chromium's own compositor
    // already moves the translate3d layer without it. 0.2.81 added it on a
    // guess and the S23 stayed jittery.
    expect(source).not.toContain('androidLayerType')
  })

  it('keeps selection edge autoscroll active and extends the dragged endpoint', () => {
    const startBlock = sliceBetween(
      'export function startEdgeScroll(',
      'export function stopEdgeScroll('
    )
    expect(startBlock.indexOf('stopEdgeScroll(scope)')).toBeLessThan(
      startBlock.indexOf('scope.edgeScrollDir = dir')
    )
    expect(startBlock.indexOf('scope.term.scrollLines(scope.edgeScrollDir)')).toBeLessThan(
      startBlock.indexOf('syncEdgeScrollSelectionEndpoint(scope)')
    )

    const dragMoveBlock = sliceBetween(
      'export function handleDragMove(',
      'function attachSurfaceEventHandlers('
    )
    expect(dragMoveBlock).toContain('scope.edgeScrollClientX = clientX')
    expect(dragMoveBlock).toContain('scope.edgeScrollClientY = clientY')
    expect(dragMoveBlock).toContain(
      'syncSelectionHandleToViewportPoint(scope, handle, clientX, clientY)'
    )
  })

  it('opens links and paths from surface taps before mouse/focus fallback', () => {
    expect(source).toContain('export function buildMouseClickInput(')
    expect(source).toContain('export function isClickMouseTrackingMode(')
    expect(source).toContain("return mode !== 'none'")
    expect(source).toContain('const pixelX = cell.x')
    expect(source).toContain('const pixelY = cell.y')
    expect(source).toContain(
      'if (!isSafeSgrMouseCoordinate(cell.x) || !isSafeSgrMouseCoordinate(cell.y)) {'
    )
    expect(source).toContain(
      'if (!isSafeSgrMouseCoordinate(sgrCol) || !isSafeSgrMouseCoordinate(sgrRow)) {'
    )
    expect(source).toContain("if (mouseTrackingMode === 'x10') {\n      return pixelPress")
    expect(source).toContain("if (mouseTrackingMode === 'x10') {\n      return sgrPress")
    expect(source).toContain("if (mouseTrackingMode === 'x10') {\n    return press")
    expect(source).toContain("col > 126 || row > 126) {\n    return ''")

    const touchEndBlock = sliceBetween(
      'function onDocumentTouchEnd(',
      '\nfunction onDocumentTouchCancel('
    )
    expect(touchEndBlock).toContain(
      'notifyTerminalSurfaceTap(scope, scope.tapCandidate.x, scope.tapCandidate.y, true)'
    )

    // The handler's own body, past its import block: the imports name these in a different order
    // than the calls do, and the order under test is the calls'.
    const tapModule = documentModuleSource('surface-tap')
    const tapHandlerBlock = tapModule.slice(
      tapModule.indexOf('export function notifyTerminalSurfaceTap(')
    )
    expect(tapHandlerBlock.indexOf('oscLinkAtViewportPoint')).toBeLessThan(
      tapHandlerBlock.indexOf('urlAtViewportPoint')
    )
    expect(tapHandlerBlock.indexOf('urlAtViewportPoint')).toBeLessThan(
      tapHandlerBlock.indexOf('filePathAtViewportPoint')
    )
    expect(tapHandlerBlock.indexOf('filePathAtViewportPoint')).toBeLessThan(
      tapHandlerBlock.indexOf('const clickInput = buildMouseClickInput')
    )
    expect(tapHandlerBlock).toContain("notify(scope, { type: 'open-url', url: tappedUrl })")
    expect(tapHandlerBlock).toContain(
      "notify(scope, { type: 'terminal-input', bytes: clickInput })"
    )
    expect(tapHandlerBlock).toContain(
      'if (focusKeyboard || !isClickMouseTrackingMode(getMouseTrackingMode(scope)))'
    )
    expect(tapHandlerBlock).toContain("notify(scope, { type: 'terminal-tap' })")
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
    expect(sessionHelperSource).toContain(
      'const tracking = isGestureMouseTrackingMode(modes.mouseTrackingMode)'
    )
    expect(inputBlock).toContain(
      '!sequences.every((sequence) => isGestureSequenceWantedByProgram(sequence, modes))'
    )
    expect(inputBlock).toContain('const sequences = splitTerminalGestureInputSequences(bytes)')
    expect(inputBlock.indexOf('splitTerminalGestureInputSequences')).toBeLessThan(
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
