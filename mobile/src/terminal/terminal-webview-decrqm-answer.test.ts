// @vitest-environment happy-dom
// The DECRQM answer (Code UI c840bc19), driven through the WebView document running the real
// xterm engine it ships with: boot the engine script and the bundled document script (#21878) out
// of XTERM_HTML, init a terminal, write the query bytes the way the host does, and read back the
// terminal-data notify. xterm 6.1.0-beta.303's own DECRQM handler throws ReferenceError, so the
// document must answer first and stop it. Before this file the answer had no behavioural test at
// all: the other harnesses stub a Terminal with no parser, so the registration threw inside its
// try and was skipped.
//
// Verified against @xterm/xterm 6.1.0-beta.303 (terminal-webview-engine.generated.ts).
import { runInThisContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'

type Posted = Record<string, unknown>

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
// Each boot runs a fresh document IIFE; its listeners must go with it, or the next test's write
// reaches two documents and is answered twice.
let listeners: {
  target: EventTarget
  type: string
  listener: EventListenerOrEventListenerObject
}[] = []

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

function send(message: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    while (frames.length > 0) {
      frames.shift()?.(performance.now())
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function replies(): string[] {
  return posted
    .filter((message) => message.type === 'terminal-data')
    .map((message) => String(message.bytes))
}

describe('the terminal document answers DECRQM itself', () => {
  beforeEach(async () => {
    posted = []
    frames = []
    listeners = []
    recordListeners(window)
    recordListeners(document)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    // happy-dom has no canvas. xterm measures glyph widths with a 2D context (an OffscreenCanvas
    // when one exists) and throws on a null one; WebGL stays null so the document takes its own
    // no-WebGL path.
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
    send({ type: 'init', id: 1, cols: 80, rows: 24, initialData: '' })
    await settle()
  })

  afterEach(() => {
    for (const { target, type, listener } of listeners) {
      target.removeEventListener(type, listener)
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('boots the real engine without reporting an engine error', () => {
    expect(posted.filter((message) => message.type === 'engine-error')).toEqual([])
    expect(posted.some((message) => message.type === 'ready')).toBe(true)
  })

  it('answers synchronized output (CSI ? 2026 $ p) as reset instead of crashing the engine', async () => {
    send({ type: 'write', id: 2, data: '\u001b[?2026$p' })
    await settle()
    expect(replies()).toEqual(['\u001b[?2026;2$y'])
    expect(posted.filter((message) => message.type === 'engine-error')).toEqual([])
  })

  it('reports a private mode the program just set as set', async () => {
    send({ type: 'write', id: 2, data: '\u001b[?2004h\u001b[?2004$p' })
    await settle()
    expect(replies()).toEqual(['\u001b[?2004;1$y'])
  })

  it('answers an ANSI mode query (CSI 20 $ p) without the private prefix', async () => {
    send({ type: 'write', id: 2, data: '\u001b[20$p' })
    await settle()
    expect(replies()).toEqual(['\u001b[20;2$y'])
  })
})
