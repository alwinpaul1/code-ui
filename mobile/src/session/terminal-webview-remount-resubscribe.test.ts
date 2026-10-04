// A terminal WebView that comes back as a new document (Android renderer loss, now remounted by
// TerminalWebView; a reload) keeps its handle and its ref, so the only thing the session sees is a
// second web-ready for a pane it already initialized. The new document has no grid, so the session
// must re-subscribe for a fresh snapshot rather than keep writing live output into nothing.
// TerminalWebView's own side is pinned by terminal-webview-engine-error.test.ts.
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileSessionTerminalWebview } from './use-mobile-session-terminal-webview'

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ hostId: 'host-1' })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))

const HANDLE = 'term_claude'

let renderer: ReactTestRenderer | null = null

function harness(options: { active: boolean }) {
  const initializedHandlesRef = { current: new Set<string>() }
  const terminalUnsubsRef = { current: new Map<string, () => void>() }
  const unsubscribeTerminal = vi.fn((handle: string) => {
    terminalUnsubsRef.current.delete(handle)
  })
  const subscribeToTerminal = vi.fn((handle: string) => {
    terminalUnsubsRef.current.set(handle, () => {})
  })
  const scope = {
    markdownDocs: new Map(),
    fileDocs: new Map(),
    terminalGestureInputQueuesRef: { current: new Map() },
    terminalGestureInputInFlightRef: { current: new Map() },
    terminalRefs: { current: new Map() },
    terminalUnsubsRef,
    initializedHandlesRef,
    terminalDiagnosticsRef: { current: new Proxy({}, { get: () => () => {} }) },
    webReadyHandlesRef: { current: new Set<string>() },
    activeHandleRef: { current: options.active ? HANDLE : 'term_other' },
    pendingActiveTerminalHandleRef: { current: null },
    activeSessionTab: null,
    unsubscribeTerminal,
    measureViewportOnce: vi.fn(async () => {}),
    subscribeToTerminal,
    nativeChatStream: { notifyWebReady: vi.fn() },
    readMarkdownTab: vi.fn(),
    readFileTab: vi.fn()
  }
  let onWebReady: (handle: string) => void = () => {}
  function Harness() {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the scope carries every member the hook reads.
    onWebReady = useMobileSessionTerminalWebview(scope as never).handleTerminalWebReady
    return null
  }
  act(() => {
    renderer = create(createElement(Harness))
  })
  return { initializedHandlesRef, terminalUnsubsRef, unsubscribeTerminal, subscribeToTerminal, onWebReady: (h: string) => onWebReady(h) }
}

describe('a terminal pane whose WebView came back as a new document', () => {
  afterEach(() => {
    act(() => {
      renderer?.unmount()
    })
    renderer = null
  })

  it('re-subscribes the active pane for a fresh snapshot', () => {
    const pane = harness({ active: true })
    // First document: ready, subscribed, and drawn from the first snapshot.
    pane.onWebReady(HANDLE)
    pane.terminalUnsubsRef.current.set(HANDLE, () => {})
    pane.initializedHandlesRef.current.add(HANDLE)
    pane.subscribeToTerminal.mockClear()

    // The remounted document reports itself.
    pane.onWebReady(HANDLE)

    expect(pane.unsubscribeTerminal).toHaveBeenCalledWith(HANDLE)
    expect(pane.initializedHandlesRef.current.has(HANDLE)).toBe(false)
    expect(pane.subscribeToTerminal).toHaveBeenCalledWith(HANDLE)
  })

  it('lets an inactive pane go until its tab is shown again', () => {
    const pane = harness({ active: false })
    pane.onWebReady(HANDLE)
    pane.terminalUnsubsRef.current.set(HANDLE, () => {})
    pane.initializedHandlesRef.current.add(HANDLE)

    pane.onWebReady(HANDLE)

    expect(pane.unsubscribeTerminal).toHaveBeenCalledWith(HANDLE)
    expect(pane.initializedHandlesRef.current.has(HANDLE)).toBe(false)
    expect(pane.subscribeToTerminal).not.toHaveBeenCalled()
  })
})
