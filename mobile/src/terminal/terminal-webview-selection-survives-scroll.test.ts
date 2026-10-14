// @vitest-environment happy-dom
// The user, 2026-10-14: "when i hold and copy if the scroll the copied part disappears but in
// claude app it doesn't". In the terminal a hold selects a word (handles, Copy pill), and the
// next finger put down on the terminal cancelled it at once, on touchstart, before anyone could
// know whether that finger meant a tap or a scroll (tap-dispatch.ts). So scrolling to see more
// of what you were copying wiped the selection.
//
// Android's own TextView, and the Claude app's Compose SelectionContainer, clear a selection on
// a TAP away from it; a scroll leaves it standing, highlight and handles moving with the text.
// These tests boot the generated document script, as the WebView runs it, with a stub xterm.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TERMINAL_DOCUMENT_SCRIPT } from './terminal-webview-document-script.generated'
import { TERMINAL_DOCUMENT_MARKUP } from './terminal-webview-html'

type Posted = Array<Record<string, unknown>>

const LINES = ['first line of output to copy', 'second line of output', 'third line']

type Screen = { viewportY: number; type: 'normal' | 'alternate'; mouseTrackingMode: string }

function makeTerminal(buffer: Screen, scrollListeners: Array<() => void>) {
  return {
    cols: 80,
    rows: 24,
    options: { fontSize: 13 },
    modes: {
      get mouseTrackingMode() {
        return buffer.mouseTrackingMode
      }
    },
    element: { scrollWidth: 800, scrollHeight: 360 },
    _core: { _renderService: { dimensions: { css: { cell: { width: 8, height: 15 } } } } },
    buffer: {
      active: {
        get viewportY() {
          return buffer.viewportY
        },
        baseY: 2,
        length: LINES.length,
        cursorY: 0,
        get type() {
          return buffer.type
        },
        getLine(row: number) {
          const text = LINES[row]
          if (text === undefined) {
            return null
          }
          return {
            translateToString: (_trim?: boolean, start?: number, end?: number) =>
              text.slice(start ?? 0, end ?? text.length),
            getCell: () => ({ extended: undefined })
          }
        }
      }
    },
    write(_d: string, cb?: () => void) {
      cb?.()
    },
    open() {},
    resize() {},
    clear() {},
    reset() {},
    refresh() {},
    selectAll() {},
    clearSelection() {},
    select() {},
    scrollLines() {},
    scrollToBottom() {},
    getSelection: () => '',
    onLineFeed: () => ({ dispose() {} }),
    onScroll: (listener: () => void) => {
      scrollListeners.push(listener)
      return { dispose() {} }
    },
    onWriteParsed: () => ({ dispose() {} }),
    dispose() {}
  }
}

const buffer: Screen = { viewportY: 0, type: 'normal', mouseTrackingMode: 'none' }
let scrollListeners: Array<() => void> = []

function boot(): Posted {
  const posted: Posted = []
  buffer.viewportY = 0
  buffer.type = 'normal'
  buffer.mouseTrackingMode = 'none'
  scrollListeners = []
  const w = window as unknown as { Terminal: unknown; ReactNativeWebView: unknown }
  w.Terminal = function () {
    return makeTerminal(buffer, scrollListeners)
  }
  w.ReactNativeWebView = {
    postMessage(s: string) {
      posted.push(JSON.parse(s))
    }
  }
  document.body.innerHTML = TERMINAL_DOCUMENT_MARKUP
  // The bundle the WebView loads, run as the WebView runs it.
  new Function(TERMINAL_DOCUMENT_SCRIPT)()
  window.dispatchEvent(
    new MessageEvent('message', { data: JSON.stringify({ type: 'init', cols: 80, rows: 24, initialData: '' }) })
  )
  return posted
}

function fireTouch(type: string, touches: Array<{ x: number; y: number }>): void {
  const surface = document.getElementById('terminal-surface') as HTMLElement
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'touches', {
    value: touches.map((p, i) => ({ identifier: i, clientX: p.x, clientY: p.y, target: surface }))
  })
  Object.defineProperty(ev, 'target', { value: surface })
  document.dispatchEvent(ev)
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Fit scale here is min(1, 200 / 640) = 0.3125, so a cell is 2.5 x 4.6875 px on screen. */
const CELL_W = 8 * 0.3125
const CELL_H = 15 * 0.3125

/** Every select-mode change the document told the host about, in order. */
function selectModes(posted: Posted): boolean[] {
  return posted.filter((m) => m.type === 'set-select-mode').map((m) => m.enabled as boolean)
}

/** A hold on the word at column 2 of the first row: the 500 ms long press starts a selection. */
async function holdToSelect(posted: Posted): Promise<void> {
  // Boot cancels any selection it inherits; count from the hold on.
  posted.length = 0
  fireTouch('touchstart', [{ x: 2 * CELL_W, y: 2 }])
  await wait(600)
  fireTouch('touchend', [])
  expect(selectModes(posted)).toEqual([true])
}

describe('a terminal selection survives scrolling the terminal', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 200, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true })
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps the selection when the next finger scrolls instead of tapping', async () => {
    const posted = boot()
    await wait(50)
    await holdToSelect(posted)
    fireTouch('touchstart', [{ x: 100, y: 200 }])
    fireTouch('touchmove', [{ x: 100, y: 230 }])
    fireTouch('touchmove', [{ x: 100, y: 290 }])
    fireTouch('touchend', [])
    expect(selectModes(posted)).toEqual([true])
  })

  // Review, 2026-10-14: where a swipe is wheel input for the program (the alternate screen, or a
  // program tracking the mouse), it does not scroll xterm: the program repaints, and a selection
  // left standing would cover, and copy, words that were never selected. There it still goes.
  it.each([
    ['the alternate screen', { type: 'alternate' as const }],
    ['a program tracking the mouse', { mouseTrackingMode: 'any' }]
  ])('still drops the selection when a swipe is wheel input for %s', async (_name, screen) => {
    const posted = boot()
    await wait(50)
    await holdToSelect(posted)
    Object.assign(buffer, screen)
    fireTouch('touchstart', [{ x: 100, y: 200 }])
    fireTouch('touchmove', [{ x: 100, y: 290 }])
    fireTouch('touchend', [])
    expect(selectModes(posted)).toEqual([true, false])
  })

  it('still clears the selection on a tap away from it, without opening anything', async () => {
    const posted = boot()
    await wait(50)
    await holdToSelect(posted)
    fireTouch('touchstart', [{ x: 100, y: 200 }])
    fireTouch('touchend', [])
    expect(selectModes(posted)).toEqual([true, false])
    expect(posted.find((m) => m.type === 'terminal-tap' || m.type === 'open-url')).toBeUndefined()
  })

  it('moves the handles with the text when the terminal scrolls under the selection', async () => {
    const posted = boot()
    await wait(50)
    await holdToSelect(posted)
    const handle = document.getElementById('sel-handle-start') as HTMLElement
    const before = Number.parseFloat(handle.style.top)
    buffer.viewportY = 1
    for (const listener of scrollListeners) {
      listener()
    }
    expect(Number.parseFloat(handle.style.top)).toBeCloseTo(before - CELL_H, 3)
  })
})
