// @vitest-environment happy-dom
// The door through which an empty snapshot reaches a pane that is already showing a screen, from
// the session's stream handler all the way into the WebView document.
//
// e2d7a75e6 (2026-09-11, S23): a host mid-reflow sends `resized` with `serialized: ''`; the pane
// went blank and Claude Code, which repaints only the rows it believes changed, never filled it
// back in. The fix made an empty `resized` a re-subscribe "for a real one". The re-subscribe's
// FIRST `scrollback` can be empty too (Orca v1.4.220's terminal-legacy-subscribe-snapshot.ts
// publishes `data: serialized?.data ?? ''`), and the session hands it to `init(cols, rows, '')`.
// On Ghostty that was a no-op; the WebView document built a fresh, empty terminal for it.
//
// The pane here is the real document script (TERMINAL_DOCUMENT_SCRIPT) behind the same commands
// `use-terminal-webview-controller.ts` posts for `init`, `write` and `resize`; only xterm is a
// stub, one that keeps the bytes each terminal was given. The screen is the newest terminal's.
// (From the Opus review of refactor/xterm-only-terminal; its first version modelled the pane, and
// this one runs the document so the test can see the engine keep the grid.)
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_DOCUMENT_SCRIPT } from '../terminal/terminal-webview-document-script.generated'
import { TERMINAL_DOCUMENT_MARKUP } from '../terminal/terminal-webview-html'
import { TerminalViewportResubscribeBudget } from './mobile-terminal-viewport-resubscribe'
import { useMobileSessionTerminalSubscription } from './use-mobile-session-terminal-subscription'

const HANDLE = 'term_claude'
const VIEWPORT = { cols: 51, rows: 38 }

type StreamEvent = Record<string, unknown>
type StubTerminal = { text: string }

let terminals: StubTerminal[] = []
let frames: FrameRequestCallback[] = []
let listeners: {
  target: EventTarget
  type: string
  listener: EventListenerOrEventListenerObject
  options?: boolean | AddEventListenerOptions
}[] = []
let nextMessageId = 1

function makeTerminal(): StubTerminal & Record<string, unknown> {
  const terminal = {
    text: '',
    cols: 80,
    rows: 24,
    options: { fontSize: 13 },
    modes: { mouseTrackingMode: 'none' },
    element: { scrollWidth: 400, scrollHeight: 570 },
    _core: { _renderService: { dimensions: { css: { cell: { width: 8, height: 15 } } } } },
    buffer: {
      active: {
        viewportY: 0,
        baseY: 0,
        length: 1,
        cursorY: 0,
        type: 'normal' as const,
        getLine: () => null
      }
    },
    write(data: string, callback?: () => void) {
      terminal.text += data
      callback?.()
    },
    open() {},
    resize(cols: number, rows: number) {
      terminal.cols = cols
      terminal.rows = rows
    },
    clear() {},
    reset() {
      terminal.text = ''
    },
    refresh() {},
    selectAll() {},
    clearSelection() {},
    select() {},
    scrollLines() {},
    scrollToBottom() {},
    scrollToLine() {},
    getSelection: () => '',
    onLineFeed: () => ({ dispose() {} }),
    onScroll: () => ({ dispose() {} }),
    onWriteParsed: () => ({ dispose() {} }),
    dispose() {}
  }
  terminals.push(terminal)
  return terminal
}

function post(command: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: JSON.stringify({ id: nextMessageId++, ...command }) })
  )
}

/** Runs the document's frames (init's ready chain) until it has none left. */
function settleDocument(): void {
  for (let i = 0; i < 20 && frames.length > 0; i++) {
    const batch = frames
    frames = []
    for (const frame of batch) {
      frame(0)
    }
  }
}

function screen(): string {
  return terminals.at(-1)?.text ?? ''
}

function harness() {
  const streams: Array<(event: StreamEvent) => void> = []
  const client = {
    subscribe: vi.fn((_method: string, _params: unknown, onData: (event: StreamEvent) => void) => {
      streams.push(onData)
      return () => {}
    })
  }
  // The handle's half, as the controller posts it.
  const pane = {
    init: vi.fn((cols: number, rows: number, initialData?: string, preserveScroll?: boolean) => {
      post({ type: 'init', cols, rows, initialData, preserveScroll })
      settleDocument()
    }),
    write: vi.fn((data: string) => {
      post({ type: 'write', data })
      settleDocument()
    }),
    resize: vi.fn((cols: number, rows: number) => {
      post({ type: 'resize', cols, rows })
      settleDocument()
    }),
    reflow: vi.fn(),
    clear: vi.fn(),
    resetZoom: vi.fn(),
    cancelSelect: vi.fn(),
    doSelectAll: vi.fn(),
    prepareForForegroundRecovery: vi.fn(),
    awaitReady: vi.fn(async () => {}),
    measureFitDimensions: vi.fn(async () => ({ ...VIEWPORT }))
  }
  const diagnostics = new Proxy({}, { get: () => () => {} })
  const terminalUnsubsRef = { current: new Map<string, () => void>() }
  const subscribingHandlesRef = { current: new Set<string>() }
  const subscribeSeqRef = { current: new Map<string, number>() }
  const layoutSeqRef = { current: new Map<string, number>() }
  const unsubscribeTerminal = (handle: string) => {
    terminalUnsubsRef.current.get(handle)?.()
    terminalUnsubsRef.current.delete(handle)
    subscribingHandlesRef.current.delete(handle)
    subscribeSeqRef.current.set(handle, (subscribeSeqRef.current.get(handle) ?? 0) + 1)
    layoutSeqRef.current.delete(handle)
  }
  const scope = {
    client,
    clientId: 'phone',
    setTerminalModes: vi.fn(),
    terminalCwdRef: { current: new Map() },
    viewportRef: { current: { ...VIEWPORT } },
    viewportMeasuredRef: { current: true },
    terminalUnsubsRef,
    subscribingHandlesRef,
    leaseOnlyHandlesRef: { current: new Set<string>() },
    initializedHandlesRef: { current: new Set<string>() },
    terminalDiagnosticsRef: { current: diagnostics },
    viewportResubscribeBudgetRef: { current: new TerminalViewportResubscribeBudget() },
    webReadyHandlesRef: { current: new Set([HANDLE]) },
    activeHandleRef: { current: HANDLE },
    subscribeSeqRef,
    layoutSeqRef,
    terminalFrameHeightRef: { current: 600 },
    scheduleDelayedAction: vi.fn(),
    showToast: vi.fn(),
    markNativeChatInputLeaseReady: vi.fn(),
    showNativeChatRef: { current: false },
    getTerminalRef: (handle: string | null) => (handle === HANDLE ? pane : undefined),
    unsubscribeTerminal,
    unsubscribeTerminalRef: { current: unsubscribeTerminal },
    signalTerminalInventoryRecovery: vi.fn()
  }
  let subscribeToTerminal: (handle: string) => void = () => {}
  function Harness() {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the scope carries every member the hook reads.
    subscribeToTerminal = useMobileSessionTerminalSubscription(scope as never).subscribeToTerminal
    return null
  }
  act(() => {
    create(createElement(Harness))
  })
  return { pane, streams, subscribe: () => subscribeToTerminal(HANDLE) }
}

describe('a Claude Code pane that is already showing a screen', () => {
  beforeEach(() => {
    terminals = []
    frames = []
    listeners = []
    nextMessageId = 1
    for (const target of [window, document] as EventTarget[]) {
      const add = target.addEventListener.bind(target)
      vi.spyOn(target, 'addEventListener').mockImplementation(((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) => {
        listeners.push({ target, type, listener, options })
        add(type, listener, options)
      }) as typeof target.addEventListener)
    }
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
    const webWindow = window as unknown as { Terminal: unknown; ReactNativeWebView: unknown }
    webWindow.Terminal = function () {
      return makeTerminal()
    }
    webWindow.ReactNativeWebView = { postMessage() {} }
    document.body.innerHTML = TERMINAL_DOCUMENT_MARKUP
    // The bundle the WebView loads, run as the WebView runs it.
    // oxlint-disable-next-line no-new-func -- the document is a script string by design
    new Function(TERMINAL_DOCUMENT_SCRIPT)()
  })

  afterEach(() => {
    for (const { target, type, listener, options } of listeners) {
      target.removeEventListener(type, listener, options)
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps its screen when the host mid-reflow sends an empty snapshot and the re-subscribe gets an empty one too', () => {
    const { pane, streams, subscribe } = harness()
    subscribe()
    streams[0]({ type: 'scrollback', serialized: 'CLAUDE-SCREEN', ...VIEWPORT })
    expect(screen()).toContain('CLAUDE-SCREEN')

    // The host mid-reflow: an empty `resized`, which the session turns into a re-subscribe.
    streams[0]({ type: 'resized', serialized: '', ...VIEWPORT })
    expect(streams).toHaveLength(2)

    // The re-subscribe's first frame, still before the host has a screen to serialize.
    streams[1]({ type: 'scrollback', serialized: '', ...VIEWPORT })

    // The session did hand the drawn pane an empty init; the document is what keeps the grid.
    expect(pane.init.mock.calls.map((call) => call[2])).toEqual(['CLAUDE-SCREEN', ''])
    expect(screen()).toContain('CLAUDE-SCREEN')
  })
})
