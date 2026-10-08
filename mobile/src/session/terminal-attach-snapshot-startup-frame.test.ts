// The door through which the attach snapshot reaches the startup-frame reader: the session's
// stream handler. Chat covers the terminal exactly when the pill matters, and the handler
// returns early for a covered handle before it touches the scrollback, so the snapshot has
// to be taken above that return (claude-startup-frame-snapshot.ts).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAttachSnapshotsForTests, startupFrameFromAttachSnapshot, takeAttachSnapshot } from './claude-startup-frame-snapshot'
import { TerminalViewportResubscribeBudget } from './mobile-terminal-viewport-resubscribe'
import { useMobileSessionTerminalSubscription } from './use-mobile-session-terminal-subscription'

// REAL snapshot (claude-startup-frame-snapshot.test.ts says how it was captured).
const SCROLLED_OFF = readFileSync(join(__dirname, 'fixtures', 'claude-attach-snapshot-2.1.294-scrolled-off.ansi'), 'utf8')
const HANDLE = 'term_claude'

type StreamEvent = Record<string, unknown>

function harness(covered: boolean) {
  const streams: Array<(event: StreamEvent) => void> = []
  const client = {
    subscribe: vi.fn((_method: string, _params: unknown, onData: (event: StreamEvent) => void) => {
      streams.push(onData)
      return () => {}
    })
  }
  const pane = {
    init: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    resetZoom: vi.fn(),
    awaitReady: vi.fn(async () => {}),
    measureFitDimensions: vi.fn(async () => ({ cols: 51, rows: 38 }))
  }
  const terminalUnsubsRef = { current: new Map<string, () => void>() }
  const scope = {
    client,
    clientId: 'phone',
    setTerminalModes: vi.fn(),
    terminalCwdRef: { current: new Map() },
    viewportRef: { current: { cols: 51, rows: 38 } },
    viewportMeasuredRef: { current: true },
    terminalUnsubsRef,
    subscribingHandlesRef: { current: new Set<string>() },
    leaseOnlyHandlesRef: { current: new Set<string>() },
    initializedHandlesRef: { current: new Set<string>() },
    terminalDiagnosticsRef: { current: new Proxy({}, { get: () => () => {} }) },
    viewportResubscribeBudgetRef: { current: new TerminalViewportResubscribeBudget() },
    webReadyHandlesRef: { current: new Set([HANDLE]) },
    activeHandleRef: { current: HANDLE },
    subscribeSeqRef: { current: new Map<string, number>() },
    layoutSeqRef: { current: new Map<string, number>() },
    terminalFrameHeightRef: { current: 600 },
    scheduleDelayedAction: vi.fn(),
    showToast: vi.fn(),
    markNativeChatInputLeaseReady: vi.fn(),
    showNativeChatRef: { current: covered },
    getTerminalRef: (handle: string | null) => (handle === HANDLE ? pane : undefined),
    unsubscribeTerminal: vi.fn(),
    unsubscribeTerminalRef: { current: vi.fn() },
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
  subscribeToTerminal(HANDLE)
  return { pane, streams }
}

describe("a Claude tab's attach snapshot reaches the startup-frame reader", () => {
  beforeEach(() => {
    resetAttachSnapshotsForTests()
  })

  it('takes the snapshot of a terminal chat covers, which never reaches a pane', () => {
    const { pane, streams } = harness(true)
    streams[0]!({ type: 'scrollback', serialized: SCROLLED_OFF, cols: 140, rows: 40 })
    expect(pane.init).not.toHaveBeenCalled()
    const held = takeAttachSnapshot(HANDLE)
    expect(held).toBe(SCROLLED_OFF)
    expect(startupFrameFromAttachSnapshot(held!)).toMatchObject({ label: 'Opus 5.5', effort: 'high' })
  })

  it('takes the snapshot of a terminal on screen too, and still draws it', () => {
    const { pane, streams } = harness(false)
    streams[0]!({ type: 'scrollback', serialized: SCROLLED_OFF, cols: 140, rows: 40 })
    expect(pane.init).toHaveBeenCalledTimes(1)
    expect(takeAttachSnapshot(HANDLE)).toBe(SCROLLED_OFF)
  })

  it('holds nothing for a plain output chunk', () => {
    const { streams } = harness(true)
    streams[0]!({ type: 'data', chunk: SCROLLED_OFF })
    expect(takeAttachSnapshot(HANDLE)).toBeNull()
  })
})
