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
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalWebViewHandle } from './terminal-webview-contract'
import { XTERM_HTML } from './terminal-webview-html'
import { useTerminalWebViewController } from './use-terminal-webview-controller'

// The controller carries the engine-error overlay, a react-native component; nothing here draws it.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({ RefreshCw: 'RefreshCw' }))

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
/** Where the document's notifies also go, when a real controller is mounted in front of it. */
let forwardToController: ((message: Posted) => void) | null = null
// Keyed by id so cancelAnimationFrame is honoured: a terminal disposed by a newer init cancels the
// repaint it had booked, and running it anyway reads a renderer that is gone.
let frames = new Map<number, FrameRequestCallback>()
let nextFrameId = 1
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
    while (frames.size > 0) {
      const [id, frame] = frames.entries().next().value!
      frames.delete(id)
      frame(performance.now())
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
    frames = new Map()
    nextFrameId = 1
    listeners = []
    nextId = 1
    recordListeners(window)
    recordListeners(document)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id)
    })
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
        postMessage: (data: string) => {
          const message = JSON.parse(data) as Posted
          posted.push(message)
          forwardToController?.(message)
        }
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

  // Two inits can reach the document back to back (the controller flushes everything it queued
  // before web-ready at once): a snapshot with content, then an empty one, before the first has
  // drawn. The empty one must neither resize the half-drawn terminal under its replay nor leave the
  // first init's `ready` to arrive late with the old geometry (found by the second review).
  it('applies an empty snapshot geometry after a snapshot still being drawn, with one ready', async () => {
    send({ type: 'init', cols: 80, rows: 24, initialData: 'SNAPSHOT-BEING-DRAWN' })
    send({ type: 'init', cols: 40, rows: 30, initialData: '' })
    expect(readyNotices()).toEqual([])

    await settle()

    expect(readyNotices()).toEqual([expect.objectContaining({ type: 'ready', cols: 40, rows: 30 })])
    expect(visibleRowCount()).toBe(30)
    expect(visibleText()).toContain('SNAPSHOT-BEING-DRAWN')
  })

  // A Clear that lands while a snapshot is still being drawn abandons that init, and its hidden
  // surface never commits. An empty snapshot after it must not keep that hidden terminal: it opens
  // a visible one, as it did before empty snapshots kept the grid.
  it('opens a visible terminal for an empty snapshot after a Clear interrupted a drawing one', async () => {
    send({ type: 'init', cols: 80, rows: 24, initialData: 'INTERRUPTED' })
    send({ type: 'clear' })
    send({ type: 'init', cols: 80, rows: 24, initialData: '' })
    await settle()

    expect(readyNotices()).toEqual([expect.objectContaining({ type: 'ready', cols: 80, rows: 24 })])
    expect(visibleRowCount()).toBe(24)
    // The surface carrying the id is the newest; an uncommitted one is still hidden.
    expect(document.getElementById('terminal-surface')?.style.visibility).not.toBe('hidden')
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

  // The handle in front of the document batches live output: the first chunk after a quiet spell
  // goes at once, the rest wait up to 48 ms (terminal-write-coalescer.ts). Its init() dropped what
  // was waiting, because a snapshot replaces the screen and those bytes are older than it. An empty
  // snapshot replaces nothing (the document keeps the drawn grid), so that output was simply lost:
  // the tail of whatever the program had just painted never reached the screen. Here the real
  // controller, with its real coalescer, posts to the real document.
  describe('with live output still waiting in the handle (real controller and coalescer)', () => {
    let renderer: ReactTestRenderer | null = null
    /** Every command the controller posted to the document, in order. */
    let sent: Posted[] = []

    afterEach(() => {
      act(() => {
        renderer?.unmount()
      })
      renderer = null
      forwardToController = null
      sent = []
    })

    function mountHandle(): TerminalWebViewHandle {
      let controller: ReturnType<typeof useTerminalWebViewController> | null = null
      function Harness() {
        controller = useTerminalWebViewController(
          {},
          {
            post: (command) => {
              sent.push(command)
              window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(command) }))
            },
            pingsOnForegroundRecovery: () => false
          }
        )
        return null
      }
      act(() => {
        renderer = create(createElement(Harness))
      })
      const mounted = controller!
      forwardToController = (message) => mounted.receive(message)
      act(() => {
        mounted.receive({ type: 'web-ready' })
      })
      return mounted.handle
    }

    function waitingOutputBeforeEmptySnapshot(pane: TerminalWebViewHandle): void {
      pane.write('LIVE-FIRST ')
      // Inside the same 48 ms window: held by the coalescer, not yet posted.
      pane.write('LIVE-WAITING')
      pane.init(80, 24, '')
    }

    it('draws live output that was still waiting when an empty snapshot arrived', async () => {
      const pane = mountHandle()
      pane.init(80, 24, 'CLAUDE-SCREEN ')
      await settle()

      waitingOutputBeforeEmptySnapshot(pane)
      await settle()

      const text = visibleText()
      expect(text).toContain('CLAUDE-SCREEN')
      expect(text).toContain('LIVE-FIRST')
      expect(text).toContain('LIVE-WAITING')
      expect(text.indexOf('LIVE-FIRST')).toBeLessThan(text.indexOf('LIVE-WAITING'))
    })

    // The same, while the snapshot before it is still being drawn: the waiting output belongs after
    // that replay, and the empty snapshot's geometry still goes out with the one `ready`.
    it('draws waiting output after a snapshot still being drawn, in order', async () => {
      const pane = mountHandle()
      // Short enough that all three still fit one row at the 40 columns it ends at.
      pane.init(80, 24, 'DRAWING ')
      pane.write('LIVE-FIRST ')
      pane.write('LIVE-WAITING')
      pane.init(40, 30, '')
      await settle()

      const text = visibleText()
      expect(text.indexOf('DRAWING')).toBeGreaterThanOrEqual(0)
      expect(text.indexOf('LIVE-FIRST')).toBeGreaterThan(text.indexOf('DRAWING'))
      expect(text.indexOf('LIVE-WAITING')).toBeGreaterThan(text.indexOf('LIVE-FIRST'))
      expect(readyNotices()).toEqual([expect.objectContaining({ type: 'ready', cols: 40, rows: 30 })])
    })

    // The window starts over at a snapshot, empty or not: the first output after it (a keystroke's
    // echo, typically) goes to the document at once instead of waiting out the rest of 48 ms.
    // Found by the review of the flush above, which had left the window running.
    it.each([
      ['with output waiting', waitingOutputBeforeEmptySnapshot],
      [
        'with nothing waiting',
        (pane: TerminalWebViewHandle) => {
          pane.write('LIVE-FIRST ')
          pane.init(80, 24, '')
        }
      ]
    ])('sends the first output after an empty snapshot at once (%s)', async (_case, before) => {
      const pane = mountHandle()
      pane.init(80, 24, 'CLAUDE-SCREEN ')
      await settle()

      before(pane)
      const sentBefore = sent.length
      pane.write('ECHO')

      expect(sent.slice(sentBefore)).toEqual([expect.objectContaining({ type: 'write', data: 'ECHO' })])
    })

    it('still drops waiting output under a snapshot with content, which replaces the screen', async () => {
      const pane = mountHandle()
      pane.init(80, 24, 'OLD-SCREEN ')
      await settle()

      pane.write('LIVE-FIRST ')
      pane.write('STALE-WAITING')
      pane.init(80, 24, 'NEW-SCREEN')
      await settle()

      expect(visibleText()).toContain('NEW-SCREEN')
      expect(visibleText()).not.toContain('STALE-WAITING')
    })

    // The degenerate end: nothing drawn yet. Output that came before the first snapshot has no
    // screen to land on; the document opens a blank terminal and the bytes go, as they always did.
    it('opens a blank terminal when output waited before an empty first snapshot', async () => {
      const pane = mountHandle()

      waitingOutputBeforeEmptySnapshot(pane)
      await settle()

      expect(readyNotices()).toEqual([expect.objectContaining({ cols: 80, rows: 24 })])
      expect(visibleRowCount()).toBe(24)
      expect(visibleText().trim()).toBe('')
    })
  })
})
