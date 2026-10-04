// An Android renderer that dies after the terminal's first document reported ready but before the
// first snapshot reached it. 13c4bbfa2 remounts the WebView after a renderer loss and the session
// re-subscribes on the second web-ready, but only for a pane it has already initialized; the review
// of that commit listed this window as uncovered: the pane is subscribed, its snapshot not yet in.
//
// Driven here end to end on the phone side: the real TerminalWebView (its remount on a kill, and
// on return to the foreground for a kill in the background) with its real controller, in front of
// the session's own foundation, subscription and web-ready hooks, wired the way TerminalPaneView
// wires them. Only the native WebView is a stand-in that records what each mount was sent, and the
// host is a stream the test feeds. "The pane comes back" = the newest WebView is sent an `init`
// carrying the host's screen.
import { createElement, useCallback } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalWebView } from '../terminal/TerminalWebView'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'
import { TerminalViewportResubscribeBudget } from './mobile-terminal-viewport-resubscribe'
import { useMobileSessionTerminalSubscription } from './use-mobile-session-terminal-subscription'
import { useMobileSessionTerminalSubscriptionFoundation } from './use-mobile-session-terminal-subscription-foundation'
import { useMobileSessionTerminalWebview } from './use-mobile-session-terminal-webview'

/** Every native WebView mounted, in order, with the commands it was posted and its latest props. */
const webViews = vi.hoisted(() => ({
  mounts: [] as { posted: Record<string, unknown>[]; props: Record<string, unknown> }[]
}))

/** The app's foreground state, with the listeners `AppState.addEventListener` registered. */
const appState = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>()
  return {
    currentState: 'active',
    addEventListener(_type: string, listener: (state: string) => void) {
      listeners.add(listener)
      return { remove: () => listeners.delete(listener) }
    },
    emit(state: string) {
      appState.currentState = state
      for (const listener of listeners) {
        listener(state)
      }
    }
  }
})

vi.mock('react-native', () => ({
  AppState: appState,
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('react-native-webview', async () => {
  const React = await import('react')
  const WebView = React.forwardRef((props: Record<string, unknown>, ref) => {
    const [mount] = React.useState(() => {
      const created = { posted: [] as Record<string, unknown>[], props }
      webViews.mounts.push(created)
      return created
    })
    mount.props = props
    React.useImperativeHandle(ref, () => ({
      postMessage: (message: string) => {
        mount.posted.push(JSON.parse(message) as Record<string, unknown>)
      },
      reload: () => {}
    }))
    return React.createElement('WebView', props)
  })
  return { WebView, default: WebView }
})

vi.mock('lucide-react-native', () => ({ RefreshCw: 'RefreshCw' }))
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({ hostId: 'host-1' }) }))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))

const HANDLE = 'term_claude'
const VIEWPORT = { cols: 51, rows: 38 }

type StreamEvent = Record<string, unknown>

let renderer: ReactTestRenderer | null = null

function harness(options: { viewportMeasured: boolean }) {
  const streams: ((event: StreamEvent) => void)[] = []
  const client = {
    subscribe: vi.fn((_method: string, _params: unknown, onData: (event: StreamEvent) => void) => {
      streams.push(onData)
      return () => {}
    })
  }
  const diagnostics = new Proxy({}, { get: () => () => {} })
  const scope = {
    client,
    clientId: 'phone',
    setTerminalModes: vi.fn(),
    setCoveredStreamRevision: vi.fn(),
    setTerminalKeyboardMetrics: vi.fn(),
    terminalCwdRef: { current: new Map() },
    viewportRef: { current: { ...VIEWPORT } },
    viewportMeasuredRef: { current: options.viewportMeasured },
    terminalRefs: { current: new Map<string, TerminalWebViewHandle>() },
    terminalUnsubsRef: { current: new Map<string, () => void>() },
    subscribingHandlesRef: { current: new Set<string>() },
    leaseOnlyHandlesRef: { current: new Set<string>() },
    initializedHandlesRef: { current: new Set<string>() },
    terminalDiagnosticsRef: { current: diagnostics },
    viewportResubscribeBudgetRef: { current: new TerminalViewportResubscribeBudget() },
    webReadyHandlesRef: { current: new Set<string>() },
    activeHandleRef: { current: HANDLE },
    pendingActiveTerminalHandleRef: { current: null },
    subscribeSeqRef: { current: new Map<string, number>() },
    layoutSeqRef: { current: new Map<string, number>() },
    terminalFrameHeightRef: { current: 600 },
    nativeChatInputLeaseReadyRef: { current: false },
    clearNativeChatInputLease: vi.fn(() => false),
    scheduleDelayedAction: vi.fn(),
    showToast: vi.fn(),
    markNativeChatInputLeaseReady: vi.fn(),
    showNativeChatRef: { current: false },
    signalTerminalInventoryRecovery: vi.fn(),
    markdownDocs: new Map(),
    fileDocs: new Map(),
    terminalGestureInputQueuesRef: { current: new Map() },
    terminalGestureInputInFlightRef: { current: new Map() },
    activeSessionTab: null,
    nativeChatStream: { notifyWebReady: vi.fn() },
    readMarkdownTab: vi.fn(),
    readFileTab: vi.fn()
  }

  function SessionPane() {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the scope carries every member the three hooks read.
    const foundation = useMobileSessionTerminalSubscriptionFoundation(scope as never)
    const withFoundation = { ...scope, ...foundation }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: as above.
    const { subscribeToTerminal } = useMobileSessionTerminalSubscription(withFoundation as never)
    const { handleTerminalWebReady, setTerminalWebViewRef } = useMobileSessionTerminalWebview(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: as above.
      { ...withFoundation, subscribeToTerminal } as never
    )
    // TerminalPaneView's two wirings.
    const setRef = useCallback(
      (ref: TerminalWebViewHandle | null) => setTerminalWebViewRef(HANDLE, ref),
      [setTerminalWebViewRef]
    )
    return createElement(TerminalWebView, {
      ref: setRef,
      onWebReady: () => handleTerminalWebReady(HANDLE)
    })
  }

  act(() => {
    renderer = create(createElement(SessionPane))
  })

  /** One of the newest WebView's event props, called the way react-native-webview calls it. */
  const fire = (prop: 'onLoadStart' | 'onMessage' | 'onRenderProcessGone', event?: unknown) => {
    const handler = webViews.mounts.at(-1)!.props[prop] as (event?: unknown) => void
    handler(event)
  }
  return {
    client,
    /** The current WebView starts loading its page. */
    loadStarts: () => act(() => fire('onLoadStart')),
    /** The current WebView's document reports itself, and the session's async subscribe runs. */
    documentComesUp: async () => {
      await act(async () => {
        fire('onMessage', { nativeEvent: { data: JSON.stringify({ type: 'web-ready' }) } })
      })
    },
    /** The system kills the current WebView's renderer (not a crash). */
    rendererKilled: () => act(() => fire('onRenderProcessGone', { nativeEvent: { didCrash: false } })),
    /** The host sends the newest subscription its first snapshot. */
    hostSendsSnapshot: (screen: string) =>
      act(() => {
        streams.at(-1)!({ type: 'scrollback', serialized: screen, ...VIEWPORT })
      })
  }
}

/** The screen the newest WebView was last told to draw, if any. */
function screenOfNewestWebView(): unknown {
  const inits = webViews.mounts.at(-1)!.posted.filter((command) => command.type === 'init')
  return inits.at(-1)?.initialData
}

describe('a terminal whose renderer dies before its first snapshot arrived', () => {
  afterEach(() => {
    act(() => {
      renderer?.unmount()
    })
    renderer = null
    webViews.mounts = []
    appState.currentState = 'active'
    vi.restoreAllMocks()
  })

  it('draws the snapshot that arrives after the new WebView came up', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pane = harness({ viewportMeasured: true })
    await pane.documentComesUp()
    expect(pane.client.subscribe).toHaveBeenCalledTimes(1)

    pane.rendererKilled()
    pane.loadStarts()
    await pane.documentComesUp()
    pane.hostSendsSnapshot('CLAUDE-SCREEN')

    expect(webViews.mounts).toHaveLength(2)
    expect(screenOfNewestWebView()).toBe('CLAUDE-SCREEN')
    expect(pane.client.subscribe).toHaveBeenCalledTimes(1)
  })

  it('comes back when the snapshot lands before the new WebView starts loading', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pane = harness({ viewportMeasured: true })
    await pane.documentComesUp()

    pane.rendererKilled()
    // Queued for the new document, then dropped by its load start, which resets the handle.
    pane.hostSendsSnapshot('SCREEN-THAT-WAS-DROPPED')
    pane.loadStarts()
    await pane.documentComesUp()
    pane.hostSendsSnapshot('CLAUDE-SCREEN')

    expect(screenOfNewestWebView()).toBe('CLAUDE-SCREEN')
    expect(pane.client.subscribe).toHaveBeenCalledTimes(2)
  })

  it('comes back when the snapshot lands while the new WebView is loading', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pane = harness({ viewportMeasured: true })
    await pane.documentComesUp()

    pane.rendererKilled()
    pane.loadStarts()
    pane.hostSendsSnapshot('CLAUDE-SCREEN')
    await pane.documentComesUp()

    expect(screenOfNewestWebView()).toBe('CLAUDE-SCREEN')
    // The session also asks again for a fresh one, which replaces it when it lands.
    pane.hostSendsSnapshot('CLAUDE-SCREEN-AGAIN')
    expect(screenOfNewestWebView()).toBe('CLAUDE-SCREEN-AGAIN')
    expect(pane.client.subscribe).toHaveBeenCalledTimes(2)
  })

  // The ordering that rests on the session alone: a kill in the background is remounted only on
  // return, and that remount drops the snapshot queued for the dead document. Only the session's
  // re-subscribe on the new web-ready brings the screen back.
  it('comes back when the renderer died in the background and the snapshot came while it was dead', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pane = harness({ viewportMeasured: true })
    await pane.documentComesUp()

    act(() => appState.emit('background'))
    pane.rendererKilled()
    pane.hostSendsSnapshot('SCREEN-THAT-WAS-DROPPED')
    expect(webViews.mounts).toHaveLength(1)
    act(() => appState.emit('active'))
    expect(webViews.mounts).toHaveLength(2)
    pane.loadStarts()
    await pane.documentComesUp()
    pane.hostSendsSnapshot('CLAUDE-SCREEN')

    expect(screenOfNewestWebView()).toBe('CLAUDE-SCREEN')
    expect(pane.client.subscribe).toHaveBeenCalledTimes(2)
  })

  // The first subscribe waits for the viewport measure, and a measure posted to a document that
  // then dies is never answered. It does not hold the pane for the measure's 2 s timeout: the new
  // document's own measure settles the old one, and the subscribe goes out at its web-ready.
  it('subscribes as soon as the new WebView is up when the renderer died during the first measure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pane = harness({ viewportMeasured: false })
    await pane.documentComesUp()
    expect(webViews.mounts[0].posted.map((command) => command.type)).toContain('measure')
    expect(pane.client.subscribe).not.toHaveBeenCalled()

    pane.rendererKilled()
    pane.loadStarts()
    await pane.documentComesUp()

    expect(pane.client.subscribe).toHaveBeenCalledTimes(1)
    pane.hostSendsSnapshot('CLAUDE-SCREEN')
    expect(screenOfNewestWebView()).toBe('CLAUDE-SCREEN')
  })
})
