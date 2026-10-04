// @vitest-environment happy-dom
// An empty snapshot over a pane that is already drawn, driven through the WebView document running
// the real xterm engine it ships with (the harness of terminal-webview-decrqm-answer.test.ts).
//
// The defect: Orca v1.4.220 publishes `data: serialized?.data ?? ''` on a subscribe snapshot, so a
// resubscribe of a drawn pane (return from chat, reconnect, the re-subscribe e2d7a75e6 makes after
// an empty `resized`) can hand the document `init(..., '')`. The document built a fresh, empty
// terminal for it, and Claude Code, which repaints only the rows it believes changed, never filled
// it back in. The Ghostty pane's `init('')` returned early ("keeps the grid when the host sends an
// empty snapshot", TerminalGhosttyView.test.tsx on main 2d0136f5e); this is the same rule, kept in
// the document because the document is what owns the grid.
//
// Verified against @xterm/xterm 6.1.0-beta.303 (terminal-webview-engine.generated.ts).
import { runInThisContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

type Posted = Record<string, unknown>

const ESC = '\u001b'

function scriptBlocks(): string[] {
  const blocks: string[] = []
  let at = XTERM_HTML.indexOf('<body>')
  for (;;) {
    const open = XTERM_HTML.indexOf('<script>', at)
    if (open === -1) {
      return blocks
    }
    const close = XTERM_HTML.indexOf('</script>', open)
    blocks.push(XTERM_HTML.slice(open + '<script>'.length, close))
    at = close
  }
}

function bodyMarkup(): string {
  const start = XTERM_HTML.indexOf('<body>') + '<body>'.length
  const end = XTERM_HTML.indexOf('<script>', start)
  return XTERM_HTML.slice(start, end)
}

let posted: Posted[] = []
let frames: FrameRequestCallback[] = []
let listeners: {
  target: EventTarget
  type: string
  listener: EventListenerOrEventListenerObject
}[] = []
let nextId = 1

function recordListeners(target: Window | Document): void {
  const add = target.addEventListener.bind(target)
  vi.spyOn(target, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => {
    listeners.push({ target, type, listener })
    add(type, listener, options)
  }) as typeof target.addEventListener)
}

/** One host command, with a fresh id the way the controller numbers them. */
function send(message: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: JSON.stringify({ id: nextId++, ...message }) })
  )
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    while (frames.length > 0) {
      frames.shift()?.(performance.now())
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** The text xterm's DOM renderer draws on the visible (committed) surface. */
function visibleText(): string {
  const surface = document.getElementById('terminal-surface')
  return surface?.querySelector('.xterm-rows')?.textContent ?? ''
}

function visibleRowCount(): number {
  const surface = document.getElementById('terminal-surface')
  return surface?.querySelector('.xterm-rows')?.children.length ?? 0
}

function readyNotices(): Posted[] {
  return posted.filter((message) => message.type === 'ready')
}

/** One finger on the visible surface, the way the WebView delivers it. */
function fireSurfaceTouch(type: string, point: { x: number; y: number } | null): void {
  const surface = document.getElementById('terminal-surface') as HTMLElement
  const event = new Event(type, { bubbles: true, cancelable: true })
  const touches = point
    ? [{ identifier: 0, clientX: point.x, clientY: point.y, target: surface }]
    : []
  Object.defineProperty(event, 'touches', { value: touches })
  Object.defineProperty(event, 'changedTouches', { value: touches })
  Object.defineProperty(event, 'target', { value: surface })
  surface.dispatchEvent(event)
}

function replies(): string[] {
  return posted
    .filter((message) => message.type === 'terminal-data')
    .map((message) => String(message.bytes))
}

describe('a drawn pane that the host sends an empty snapshot (real xterm engine)', () => {
  beforeEach(() => {
    posted = []
    frames = []
    listeners = []
    nextId = 1
    recordListeners(window)
    recordListeners(document)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => {
      if (kind !== '2d') {
        return null
      }
      const metrics = { width: 8, actualBoundingBoxAscent: 11, actualBoundingBoxDescent: 3 }
      return new Proxy(
        { measureText: () => metrics, getImageData: () => ({ data: new Uint8ClampedArray(4) }) },
        {
          get: (target, key) => (key in target ? target[key as keyof typeof target] : () => {}),
          set: () => true
        }
      )
    }) as never)
    Object.assign(window, {
      ReactNativeWebView: {
        postMessage: (data: string) => posted.push(JSON.parse(data) as Posted)
      }
    })
    document.body.innerHTML = bodyMarkup()
    const [engine, documentScript] = scriptBlocks()
    runInThisContext(engine!)
    runInThisContext(documentScript!)
  })

  afterEach(() => {
    for (const { target, type, listener } of listeners) {
      target.removeEventListener(type, listener)
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps a drawn screen when the host sends an empty snapshot instead of blanking it', async () => {
    send({ type: 'init', cols: 80, rows: 24, initialData: 'CLAUDE-CODE-SCREEN-ROW' })
    await settle()
    expect(visibleText()).toContain('CLAUDE-CODE-SCREEN-ROW')

    send({ type: 'init', cols: 80, rows: 24, initialData: '' })
    await settle()

    expect(visibleText()).toContain('CLAUDE-CODE-SCREEN-ROW')
  })

  it('keeps a screen drawn by live output alone when an empty snapshot follows', async () => {
    send({ type: 'init', cols: 80, rows: 24, initialData: '' })
    await settle()
    send({ type: 'write', data: 'user@host % ' })
    await settle()
    expect(visibleText()).toContain('user@host %')

    send({ type: 'init', cols: 80, rows: 24 })
    await settle()

    expect(visibleText()).toContain('user@host %')
  })

  it('applies the empty snapshot geometry to the kept screen and answers the ready wait', async () => {
    send({ type: 'init', cols: 80, rows: 24, initialData: 'CLAUDE-CODE-SCREEN-ROW' })
    await settle()
    const readyBefore = readyNotices().length

    send({ type: 'init', cols: 51, rows: 30, initialData: '' })
    await settle()

    // The handle's init() armed a ready promise that measureFitDimensions awaits.
    expect(readyNotices().slice(readyBefore)).toEqual([
      expect.objectContaining({ type: 'ready', cols: 51, rows: 30 })
    ])
    expect(visibleRowCount()).toBe(30)
    expect(visibleText()).toContain('CLAUDE-CODE-SCREEN-ROW')
  })

  // A fresh terminal starts in the normal buffer with no mouse mode, and the document does not
  // re-announce "none" after an init, so the phone kept believing Claude Code took the swipe while
  // the document scrolled its own empty buffer under the finger. A kept grid keeps the program's
  // modes with it. (happy-dom gives xterm no cell box, so the document cannot place an SGR wheel
  // report here and sends its arrow-row fallback instead; what this pins is WHERE the swipe goes:
  // to the program as input, not into local scrollback.)
  it('still sends a swipe to Claude Code after an empty snapshot', async () => {
    send({
      type: 'init',
      cols: 80,
      rows: 24,
      initialData: `${ESC}[?1049h${ESC}[?1003h${ESC}[?1006hclaude`
    })
    await settle()
    send({ type: 'init', cols: 80, rows: 24, initialData: '' })
    await settle()
    posted = []

    fireSurfaceTouch('touchstart', { x: 100, y: 300 })
    fireSurfaceTouch('touchmove', { x: 100, y: 200 })

    expect(posted.filter((message) => message.type === 'terminal-input')).not.toEqual([])
  })

  it('still answers a live query after an empty snapshot kept the screen', async () => {
    send({ type: 'init', cols: 80, rows: 24, initialData: 'drawn' })
    await settle()
    send({ type: 'init', cols: 80, rows: 24, initialData: '' })
    await settle()

    send({ type: 'write', data: `${ESC}[6n` })
    await settle()

    expect(replies()).toHaveLength(1)
    expect(replies()[0]).toMatch(new RegExp(`^${ESC}\\[\\d+;\\d+R$`))
  })

  it('replaces the kept screen with the next snapshot that has content', async () => {
    send({ type: 'init', cols: 80, rows: 24, initialData: 'OLD-SCREEN' })
    await settle()
    send({ type: 'init', cols: 80, rows: 24, initialData: '' })
    await settle()

    send({ type: 'init', cols: 80, rows: 24, initialData: 'NEW-SCREEN' })
    await settle()

    expect(visibleText()).toContain('NEW-SCREEN')
    expect(visibleText()).not.toContain('OLD-SCREEN')
  })

  // The degenerate end: a document that has no terminal yet. An empty first snapshot (a host
  // screen with nothing on it) must still open a terminal, or measure and input have nothing.
  it('opens a blank terminal for an empty first snapshot', async () => {
    send({ type: 'init', cols: 80, rows: 24, initialData: '' })
    await settle()

    expect(readyNotices()).toEqual([expect.objectContaining({ cols: 80, rows: 24 })])
    expect(visibleRowCount()).toBe(24)
    expect(visibleText().trim()).toBe('')
  })
})
