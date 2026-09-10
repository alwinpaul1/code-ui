// @vitest-environment happy-dom
// Touch scrolling of the NORMAL buffer, driven against the real injected
// document: boot the IIFE, dispatch real touch events at a chosen frame rate,
// and read back what the compositor would actually show.
//
// Verified against xterm 6.1 (mobile/src/terminal/terminal-webview-engine.generated.ts)
// and the Galaxy S23 (120 Hz) report of jerky scrollback.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

const CELL_HEIGHT = 15
const CELL_WIDTH = 8
const VIEWPORT_WIDTH = 381
const VIEWPORT_HEIGHT = 600
// Wider than the viewport so the horizontal-pan branch (and clampPan) runs.
const CONTENT_WIDTH = 900
const FRAME_60HZ_MS = 1000 / 60
const FRAME_120HZ_MS = 1000 / 120

type BufferState = { baseY: number; type: 'alternate' | 'normal'; viewportY: number }
type Frame = { cb: (time: number) => void; id: number }
type Registered = {
  listener: EventListenerOrEventListenerObject
  options?: boolean | AddEventListenerOptions
  target: EventTarget
  type: string
}
type LayoutReads = {
  innerHeight: number
  innerWidth: number
  scrollHeight: number
  scrollWidth: number
}

let buffer: BufferState
let clock = 0
let layoutReads: LayoutReads
let nextFrameId = 1
let paintFramePending = false
let paintedViewportY = 0
let pendingFrames: Frame[] = []
let posted: Record<string, unknown>[] = []
let registeredListeners: Registered[] = []
let scrollListeners: (() => void)[] = []
let writeParsedListeners: (() => void)[] = []
let renderListeners: (() => void)[] = []
// Why: xterm buffers repaints while DEC 2026 synchronized output is on and
// releases them on the closing sequence (or a 1 s timeout). Claude Code wraps
// every frame in it, and the relay can split a frame across chunks.
let paintWithheld = false

function iifeSource(): string {
  const start = XTERM_HTML.indexOf('(function() {')
  const end = XTERM_HTML.lastIndexOf('})();')
  return XTERM_HTML.slice(start, end + '})();'.length)
}

function bodyMarkup(): string {
  const start = XTERM_HTML.indexOf('<body>') + '<body>'.length
  const end = XTERM_HTML.indexOf('<script>', start)
  return XTERM_HTML.slice(start, end)
}

function makeTerminal() {
  const terminal = {
    cols: 40,
    rows: 24,
    options: { fontSize: 13 },
    modes: { mouseTrackingMode: 'none' as string },
    element: null as HTMLElement | null,
    _core: {
      _renderService: {
        dimensions: { css: { cell: { height: CELL_HEIGHT, width: CELL_WIDTH } } }
      }
    },
    buffer: {
      active: {
        get baseY() {
          return buffer.baseY
        },
        get type() {
          return buffer.type
        },
        get viewportY() {
          return buffer.viewportY
        },
        cursorY: 0,
        length: 1,
        getLine: () => null,
        getNullCell: () => ({})
      }
    },
    write(_data: string, callback?: () => void) {
      // Why: agent output books xterm's next paint exactly like a scroll does.
      bookPaint()
      callback?.()
    },
    open(surface: HTMLElement) {
      // Why: the fractional offset is written to xterm's own .xterm-screen, so
      // the stub has to reproduce that element or the test proves nothing.
      const root = document.createElement('div')
      root.className = 'xterm'
      const screen = document.createElement('div')
      screen.className = 'xterm-screen'
      root.append(screen)
      surface.append(root)
      Object.defineProperty(root, 'scrollWidth', {
        configurable: true,
        get() {
          layoutReads.scrollWidth++
          return CONTENT_WIDTH
        }
      })
      Object.defineProperty(root, 'scrollHeight', {
        configurable: true,
        get() {
          layoutReads.scrollHeight++
          return CELL_HEIGHT * 24
        }
      })
      terminal.element = root
    },
    loadAddon() {},
    resize(cols: number, rows: number) {
      terminal.cols = cols
      terminal.rows = rows
    },
    clear() {},
    reset() {},
    refresh() {
      bookPaint()
    },
    selectAll() {},
    clearSelection() {},
    select() {},
    scrollLines(lines: number) {
      const next = Math.max(0, Math.min(buffer.baseY, buffer.viewportY + lines))
      if (next === buffer.viewportY) {
        return
      }
      buffer.viewportY = next
      // Why: xterm's RenderDebouncer paints committed rows on ITS OWN animation
      // frame, one frame after scrollLines() returns. Model that lag or the test
      // cannot see the whole-row overshoot that got fractional transforms banned.
      bookPaint()
      for (const listener of scrollListeners) {
        listener()
      }
    },
    scrollToBottom() {},
    scrollToLine() {},
    attachCustomKeyEventHandler() {},
    getSelection: () => '',
    onData: () => ({ dispose() {} }),
    onLineFeed: () => ({ dispose() {} }),
    onScroll: (callback: () => void) => {
      scrollListeners.push(callback)
      return { dispose() {} }
    },
    onWriteParsed: (callback: () => void) => {
      writeParsedListeners.push(callback)
      return { dispose() {} }
    },
    onRender: (callback: () => void) => {
      renderListeners.push(callback)
      return { dispose() {} }
    },
    dispose() {}
  }
  return terminal
}

// Why: xterm's RenderDebouncer paints on ITS OWN animation frame, one frame
// after scrollLines()/write() returns, and one pending frame absorbs every
// request made before it runs. Model that or the tests cannot see a row
// landing a frame before (or after) the remainder written for it.
function bookPaint(): void {
  if (paintFramePending) {
    return
  }
  paintFramePending = true
  requestAnimationFrame(() => {
    paintFramePending = false
    if (paintWithheld) {
      return
    }
    paintedViewportY = buffer.viewportY
    for (const listener of renderListeners) {
      listener()
    }
  })
}

function runFrame(stepMs: number): void {
  clock += stepMs
  const batch = pendingFrames
  pendingFrames = []
  for (const frame of batch) {
    frame.cb(clock)
  }
}

function runFrames(count: number, stepMs = FRAME_60HZ_MS): void {
  for (let i = 0; i < count; i++) {
    if (pendingFrames.length === 0) {
      return
    }
    runFrame(stepMs)
  }
}

function runUntilIdle(stepMs: number, maxFrames = 4000): number {
  let frames = 0
  while (pendingFrames.length > 0 && frames < maxFrames) {
    runFrame(stepMs)
    frames++
  }
  return frames
}

function surfaceElement(): HTMLElement {
  const surface = document.getElementById('terminal-surface')
  if (!surface) {
    throw new Error('terminal surface missing')
  }
  return surface
}

function screenTranslateY(): number {
  const screen = document.querySelector('.xterm-screen') as HTMLElement | null
  if (!screen) {
    throw new Error('xterm screen element missing')
  }
  const match = /translate3d\(0(?:px)?,\s*(-?[\d.]+)px,\s*0(?:px)?\)/.exec(screen.style.transform)
  return match ? Number(match[1]) : 0
}

function fireTouch(type: string, points: { x: number; y: number }[]): void {
  const surface = surfaceElement()
  const event = new Event(type, { bubbles: true, cancelable: true })
  const touches = points.map((point, index) => ({
    clientX: point.x,
    clientY: point.y,
    identifier: index,
    target: surface
  }))
  Object.defineProperty(event, 'touches', { value: touches })
  Object.defineProperty(event, 'changedTouches', { value: touches })
  Object.defineProperty(event, 'target', { value: surface })
  surface.dispatchEvent(event)
}

/** Drags one finger up the screen (newer rows) at a steady pixels-per-ms speed. */
function dragUp(options: {
  frameMs: number
  moves: number
  pxPerMs: number
  startY?: number
}): number {
  const startY = options.startY ?? 500
  let y = startY
  fireTouch('touchstart', [{ x: 100, y }])
  for (let i = 0; i < options.moves; i++) {
    clock += options.frameMs
    y -= options.pxPerMs * options.frameMs
    fireTouch('touchmove', [{ x: 100, y }])
    runFrames(3, 0)
  }
  return y
}

// Why: every boot leaves its own document/window listeners behind (the message
// bridge and the latching touch dispatcher). Left attached, a second boot in the
// same test file gets N documents reacting to one init and the surface handlers
// stop matching the visible surface.
function teardownBoot(): void {
  for (const entry of registeredListeners) {
    entry.target.removeEventListener(entry.type, entry.listener as EventListener, entry.options)
  }
  registeredListeners = []
}

function boot(state: Partial<BufferState> = {}): void {
  teardownBoot()
  scrollListeners = []
  writeParsedListeners = []
  renderListeners = []
  paintWithheld = false
  buffer = { baseY: 5000, type: 'normal', viewportY: 2500, ...state }
  document.body.innerHTML = bodyMarkup()
  // eslint-disable-next-line no-new-func
  new Function(iifeSource())()
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({ cols: 40, initialData: '', rows: 24, type: 'init' })
    })
  )
  runFrames(12)
  paintFramePending = false
  paintedViewportY = buffer.viewportY
  posted = []
  layoutReads = { innerHeight: 0, innerWidth: 0, scrollHeight: 0, scrollWidth: 0 }
}

describe('terminal WebView touch scrolling', () => {
  beforeEach(() => {
    clock = 0
    nextFrameId = 1
    paintFramePending = false
    paintedViewportY = 0
    pendingFrames = []
    posted = []
    registeredListeners = []
    scrollListeners = []
    writeParsedListeners = []
    renderListeners = []
    paintWithheld = false
    layoutReads = { innerHeight: 0, innerWidth: 0, scrollHeight: 0, scrollWidth: 0 }
    for (const target of [window, document] as EventTarget[]) {
      const original = target.addEventListener.bind(target)
      vi.spyOn(target, 'addEventListener').mockImplementation(((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) => {
        registeredListeners.push({ listener, options, target, type })
        original(type, listener, options)
      }) as typeof target.addEventListener)
    }
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
      const id = nextFrameId++
      pendingFrames.push({ cb: callback, id })
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pendingFrames = pendingFrames.filter((frame) => frame.id !== id)
    })
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      get() {
        layoutReads.innerWidth++
        return VIEWPORT_WIDTH
      }
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      get() {
        layoutReads.innerHeight++
        return VIEWPORT_HEIGHT
      }
    })
    const webWindow = window as unknown as {
      ReactNativeWebView: { postMessage: (data: string) => void }
      Terminal: new () => ReturnType<typeof makeTerminal>
    }
    webWindow.Terminal = function () {
      return makeTerminal()
    } as unknown as new () => ReturnType<typeof makeTerminal>
    webWindow.ReactNativeWebView = {
      postMessage(data: string) {
        posted.push(JSON.parse(data) as Record<string, unknown>)
      }
    }
  })

  afterEach(() => {
    teardownBoot()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('scrolls by the finger\'s fractional distance, not whole rows', () => {
    boot()

    fireTouch('touchstart', [{ x: 100, y: 500 }])
    fireTouch('touchmove', [{ x: 100, y: 494 }])
    runFrames(3, FRAME_120HZ_MS)

    // Six CSS pixels of finger travel must move six pixels of content, even
    // though that is well under one 15px xterm row.
    expect(buffer.viewportY).toBe(2500)
    expect(screenTranslateY()).toBeCloseTo(-6, 5)

    fireTouch('touchmove', [{ x: 100, y: 482 }])
    runFrames(3, FRAME_120HZ_MS)

    // 18px of travel commits exactly one row and keeps the 3px remainder.
    expect(buffer.viewportY).toBe(2501)
    expect(screenTranslateY()).toBeCloseTo(-3, 5)
  })

  it('advances by the finger\'s distance on every frame, including the frame a row commits', () => {
    boot()
    const stepPx = 5
    let y = 500
    fireTouch('touchstart', [{ x: 100, y }])
    const startRow = paintedViewportY
    // What the compositor actually shows: the PAINTED rows, plus the transform
    // that was written for them.
    const visualY = (): number =>
      -(paintedViewportY - startRow) * CELL_HEIGHT + screenTranslateY()

    const samples: number[] = []
    for (let i = 0; i < 12; i++) {
      y -= stepPx
      fireTouch('touchmove', [{ x: 100, y }])
      runFrame(FRAME_120HZ_MS)
      samples.push(visualY())
    }

    // Why: writing the remainder in the same frame as term.scrollLines() puts
    // it a frame ahead of the repaint, so every row boundary jumps a whole row
    // forward and then back. Each frame must move exactly the finger's step.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i] - samples[i - 1]).toBeCloseTo(-stepPx, 5)
    }
    expect(buffer.viewportY).toBeGreaterThan(startRow)
  })

  it('leaves the terminal on a row boundary after the finger lifts', () => {
    boot()

    fireTouch('touchstart', [{ x: 100, y: 500 }])
    fireTouch('touchmove', [{ x: 100, y: 497 }])
    runFrames(3, FRAME_120HZ_MS)
    expect(screenTranslateY()).toBeCloseTo(-3, 5)

    fireTouch('touchend', [])
    runUntilIdle(FRAME_120HZ_MS)

    expect(screenTranslateY()).toBe(0)
    expect(buffer.viewportY).toBe(2500)
  })

  it('commits the last row when the finger lifts past the halfway mark', () => {
    boot()

    fireTouch('touchstart', [{ x: 100, y: 500 }])
    fireTouch('touchmove', [{ x: 100, y: 488 }])
    runFrames(3, FRAME_120HZ_MS)
    expect(screenTranslateY()).toBeCloseTo(-12, 5)

    fireTouch('touchend', [])
    runUntilIdle(FRAME_120HZ_MS)

    expect(screenTranslateY()).toBe(0)
    expect(buffer.viewportY).toBe(2501)
  })

  it('a fling travels the same distance at 60 Hz and 120 Hz', () => {
    // Why: measured from the lift, so the comparison is the FLING alone and not
    // the different number of finger samples each refresh rate produces.
    function flingRows(frameMs: number): number {
      boot()
      dragUp({ frameMs, moves: 10, pxPerMs: 1.2 })
      const atLift = buffer.viewportY
      fireTouch('touchend', [])
      runUntilIdle(frameMs)
      return buffer.viewportY - atLift
    }

    const rowsAt60 = flingRows(FRAME_60HZ_MS)
    const rowsAt120 = flingRows(FRAME_120HZ_MS)

    expect(rowsAt60).toBeGreaterThan(20)
    // A refresh-rate-independent fling lands within a row of the same place.
    expect(Math.abs(rowsAt120 - rowsAt60)).toBeLessThanOrEqual(1)
  })

  it('does not stall a fling when the compositor drops a frame', () => {
    // The fling is time-based, so a frame that arrives late should cover the
    // time it actually took. Clamping that catch-up to a single 60 Hz frame
    // makes a janky frame eat the fling's travel AND its friction, which reads
    // as the scroll snagging mid-flight.
    function flingRows(dropAtFrame: number | null): number {
      boot()
      dragUp({ frameMs: FRAME_60HZ_MS, moves: 10, pxPerMs: 1.2 })
      const atLift = buffer.viewportY
      fireTouch('touchend', [])
      let frames = 0
      while (pendingFrames.length > 0 && frames < 4000) {
        // One janky frame: the phone missed two vsyncs.
        runFrame(frames === dropAtFrame ? FRAME_60HZ_MS * 3 : FRAME_60HZ_MS)
        frames++
      }
      return buffer.viewportY - atLift
    }

    const smooth = flingRows(null)
    const janky = flingRows(3)

    expect(smooth).toBeGreaterThan(20)
    expect(Math.abs(janky - smooth)).toBeLessThanOrEqual(1)
  })

  it('bends at the top of the scrollback instead of stopping dead', () => {
    // The one place this scroller still reads as a web page rather than a
    // native one: at either end of the buffer the content simply refuses to
    // move. Native scrollers let it follow the finger with rising resistance
    // and spring back. UIScrollView's own curve is f(x,d,c) = x*d*c/(d+c*x)
    // with c = 0.55, which is what this pulls against.
    boot({ viewportY: 0 })

    // Already at the oldest row: drag further back.
    let y = 200
    fireTouch('touchstart', [{ x: 100, y }])
    for (let i = 0; i < 8; i++) {
      clock += FRAME_60HZ_MS
      y += 12
      fireTouch('touchmove', [{ x: 100, y }])
      runFrames(3, 0)
    }

    const pulled = screenTranslateY()
    expect(buffer.viewportY).toBe(0)
    // It should have followed the finger somewhat, but far less than the 96px
    // the finger travelled — that gap is the resistance.
    expect(pulled).toBeGreaterThan(0)
    expect(pulled).toBeLessThan(96)

    fireTouch('touchend', [])
    runUntilIdle(FRAME_60HZ_MS)

    // And it must come all the way back: a resting offset breaks every
    // cell-to-pixel mapping (taps, selection handles, mouse reports).
    expect(screenTranslateY()).toBe(0)
  })

  it('does not read layout on every touchmove', () => {
    boot()

    fireTouch('touchstart', [{ x: 100, y: 500 }])
    const afterStart = { ...layoutReads }
    for (let i = 1; i <= 6; i++) {
      fireTouch('touchmove', [{ x: 100 + i, y: 500 - i * 7 }])
      runFrames(3, FRAME_120HZ_MS)
    }

    // Why: scrollWidth/scrollHeight and innerWidth/innerHeight force a
    // synchronous layout, and the touchmove path used to take them per move,
    // right before writing the style that dirties layout again.
    expect(layoutReads.scrollWidth - afterStart.scrollWidth).toBe(0)
    expect(layoutReads.scrollHeight - afterStart.scrollHeight).toBe(0)
    expect(layoutReads.innerWidth - afterStart.innerWidth).toBe(0)
    expect(layoutReads.innerHeight - afterStart.innerHeight).toBe(0)
  })

  it('defers keyboard metrics until the scroll gesture ends', () => {
    boot()
    expect(writeParsedListeners.length).toBeGreaterThan(0)

    fireTouch('touchstart', [{ x: 100, y: 500 }])
    fireTouch('touchmove', [{ x: 100, y: 470 }])
    posted = []
    for (const listener of writeParsedListeners) {
      listener()
      listener()
    }

    // Why: the metrics walk rows x cols cells and post JSON. On the frame we
    // are trying to hit at 120 Hz that is the most expensive thing running.
    expect(posted.filter((msg) => msg.type === 'keyboard-avoidance-metrics')).toHaveLength(0)

    fireTouch('touchend', [])
    runUntilIdle(FRAME_120HZ_MS)

    expect(posted.filter((msg) => msg.type === 'keyboard-avoidance-metrics')).toHaveLength(1)
  })

  it('repaints the scroll indicator once per frame, not once per committed row', () => {
    boot()
    const thumb = document.getElementById('scroll-thumb') as HTMLElement
    let thumbWrites = 0
    const style = thumb.style as unknown as { transform: string }
    let transformValue = ''
    Object.defineProperty(style, 'transform', {
      configurable: true,
      get: () => transformValue,
      set: (value: string) => {
        thumbWrites++
        transformValue = value
      }
    })

    fireTouch('touchstart', [{ x: 100, y: 500 }])
    fireTouch('touchmove', [{ x: 100, y: 440 }])
    runFrames(1, FRAME_120HZ_MS)

    // Four committed rows used to repaint the indicator eight times (once from
    // term.onScroll, once from the scroll delta) and read innerHeight each time.
    expect(buffer.viewportY).toBe(2504)
    expect(thumbWrites).toBeLessThanOrEqual(1)
  })
  it('shows the finger\'s move on the very next frame, not two frames later', () => {
    boot()

    fireTouch('touchstart', [{ x: 100, y: 500 }])
    fireTouch('touchmove', [{ x: 100, y: 494 }])
    runFrame(FRAME_120HZ_MS)

    // Why: Chromium already hands the page one touchmove per frame. Parking the
    // delta in a second animation frame before scrolling added a whole frame of
    // lag on top of the one xterm needs to paint — 3 frames finger-to-glass on
    // the S23, which reads as "laggy" at 120 Hz.
    expect(screenTranslateY()).toBeCloseTo(-6, 5)
  })

  it('keeps every frame\'s step even when agent output already booked xterm\'s repaint', () => {
    boot()
    const stepPx = 5
    let y = 500
    fireTouch('touchstart', [{ x: 100, y }])
    const startRow = paintedViewportY
    const visualY = (): number =>
      -(paintedViewportY - startRow) * CELL_HEIGHT + screenTranslateY()

    const samples: number[] = []
    for (let i = 0; i < 12; i++) {
      y -= stepPx
      fireTouch('touchmove', [{ x: 100, y }])
      // Why: a streaming agent lands a write in the same frame as the finger.
      // xterm folds the scroll's repaint into the frame that write already
      // booked, so the rows move a frame before the remainder written for them
      // — the 21px-forward, 9px-back oscillation measured in Chrome.
      bookPaint()
      runFrame(FRAME_120HZ_MS)
      samples.push(visualY())
    }

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i] - samples[i - 1]).toBeCloseTo(-stepPx, 5)
    }
    expect(buffer.viewportY).toBeGreaterThan(startRow)
  })

  it('keeps the picture moving while synchronized output withholds the repaint', () => {
    boot()
    const stepPx = 5
    let y = 500
    fireTouch('touchstart', [{ x: 100, y }])
    const startRow = paintedViewportY
    const visualY = (): number =>
      -(paintedViewportY - startRow) * CELL_HEIGHT + screenTranslateY()

    // Claude Code opened a synchronized-output frame and the relay has not
    // delivered the close yet: xterm parks every repaint, scroll included.
    paintWithheld = true
    const samples: number[] = []
    for (let i = 0; i < 12; i++) {
      y -= stepPx
      fireTouch('touchmove', [{ x: 100, y }])
      runFrame(FRAME_120HZ_MS)
      samples.push(visualY())
    }
    expect(paintedViewportY).toBe(startRow)
    expect(buffer.viewportY).toBeGreaterThan(startRow)
    // Why: the rows xterm has not painted yet must be carried by the transform,
    // or the content stands still (and snaps) while the finger keeps moving.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i] - samples[i - 1]).toBeCloseTo(-stepPx, 5)
    }

    // The close arrives: xterm paints the committed rows in one go. The picture
    // must not jump — the transform gives back exactly what the rows now carry.
    paintWithheld = false
    const before = visualY()
    bookPaint()
    runFrame(FRAME_120HZ_MS)
    expect(paintedViewportY).toBe(buffer.viewportY)
    expect(visualY()).toBeCloseTo(before, 5)
  })
})
