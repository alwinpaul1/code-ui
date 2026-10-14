// Reported after 0.9.139 (2026-10-14): coming back to the app from the Home
// screen still reflows the terminal once. The pane stays subscribed across
// HOME. On the way out the view switch hands the PTY back to the desk
// ('desktop'), and the host answers on the live stream with a desktop-width
// `resized` frame, which the pane takes while the app is in the background.
// On the way back the view switch asks for 'auto' again. Until the host's
// phone-width `resized` lands, the pane shows the desktop-width frame, and
// then that frame reflows.
//
// The pane must go back under the first-frame cover on the way out. It must
// stay covered through any desktop-mode frame, and show again on the first
// phone-mode frame after the resume. If the resume claim is refused or never
// answered, the timeout armed at resume lifts the cover and says why.
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalViewportResubscribeBudget } from './mobile-terminal-viewport-resubscribe'
import { useMobileSessionTerminalSubscription } from './use-mobile-session-terminal-subscription'
import {
  TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS,
  useTerminalFirstFrameReveal
} from '../terminal/terminal-first-frame-reveal'

const PHONE = { cols: 51, rows: 38 }
const DESKTOP = { cols: 160, rows: 48 }

type StreamEvent = Record<string, unknown>

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve()
    }
  })
}

function harness(handle: string) {
  const streams: Array<(event: StreamEvent) => void> = []
  let reveal!: ReturnType<typeof useTerminalFirstFrameReveal>
  const visible: Array<{ cols: number; shown: boolean }> = []
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
    measureFitDimensions: vi.fn(async () => ({ ...PHONE }))
  }
  const unsubscribeTerminal = vi.fn()
  const scope = {
    client,
    clientId: 'phone',
    setTerminalModes: vi.fn(),
    terminalCwdRef: { current: new Map() },
    viewportRef: { current: { ...PHONE } },
    viewportMeasuredRef: { current: true },
    terminalUnsubsRef: { current: new Map<string, () => void>() },
    subscribingHandlesRef: { current: new Set<string>() },
    leaseOnlyHandlesRef: { current: new Set<string>() },
    initializedHandlesRef: { current: new Set<string>() },
    terminalDiagnosticsRef: { current: new Proxy({}, { get: () => () => {} }) },
    viewportResubscribeBudgetRef: { current: new TerminalViewportResubscribeBudget() },
    webReadyHandlesRef: { current: new Set([handle]) },
    activeHandleRef: { current: handle },
    subscribeSeqRef: { current: new Map<string, number>() },
    layoutSeqRef: { current: new Map<string, number>() },
    terminalFrameHeightRef: { current: 600 },
    scheduleDelayedAction: vi.fn(),
    showToast: vi.fn(),
    markNativeChatInputLeaseReady: vi.fn(),
    showNativeChatRef: { current: false },
    getTerminalRef: (h: string | null) => (h === handle ? pane : undefined),
    unsubscribeTerminal,
    unsubscribeTerminalRef: { current: unsubscribeTerminal },
    signalTerminalInventoryRecovery: vi.fn()
  }
  let subscribeToTerminal: (h: string) => void = () => {}
  function Harness() {
    reveal = useTerminalFirstFrameReveal()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the scope carries every member the hook reads.
    subscribeToTerminal = useMobileSessionTerminalSubscription({ ...scope, ...reveal } as never).subscribeToTerminal
    return null
  }
  act(() => {
    create(createElement(Harness))
  })
  const shown = () => reveal.revealedTerminalHandles.has(handle)
  const emit = (event: StreamEvent) =>
    act(() => {
      streams.at(-1)?.(event)
    })
  return {
    get shown() {
      return shown()
    },
    visible,
    /** Opened and settled at phone width, as a tab is before HOME. */
    async open() {
      act(() => subscribeToTerminal(handle))
      emit({ type: 'scrollback', cols: PHONE.cols, rows: PHONE.rows, serialized: '❯ ', seq: 1, displayMode: 'auto' })
      await flush()
    },
    /** What the view switch does on the way out (use-mobile-session-view-switch.ts). */
    leave: () =>
      act(() => {
        reveal.coverTerminalUntilPhoneFrame(handle)
      }),
    /** ...and on the way back. */
    resume: () =>
      act(() => {
        reveal.armTerminalFirstFrameRevealTimeout(handle)
      }),
    async resized(dims: { cols: number; rows: number }, displayMode: string, seq: number) {
      emit({ type: 'resized', cols: dims.cols, rows: dims.rows, displayMode, seq, serialized: '❯ ' })
      await flush()
      visible.push({ cols: dims.cols, shown: shown() })
    }
  }
}

describe('coming back from the Home screen shows the terminal at phone width, with no reflow', () => {
  let logs: unknown[][]
  beforeEach(() => {
    vi.useFakeTimers()
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args)
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('never shows the desktop-width frame the hand-back drew while the app was away', async () => {
    const h = harness('pty-1')
    await h.open()
    expect(h.shown).toBe(true)
    h.leave()
    // The desk takes its width back while the app is in the background.
    await h.resized(DESKTOP, 'desktop', 2)
    h.resume()
    expect(h.shown).toBe(false)
    // The resume's 'auto' lands: the host lays the screen out for the phone again.
    await h.resized(PHONE, 'auto', 3)
    expect(h.shown).toBe(true)
    expect(h.visible.filter((v) => v.cols === DESKTOP.cols && v.shown)).toEqual([])
  })

  it('shows the pane again when the hand-back never resized it (the host answered with a mode change only)', async () => {
    const h = harness('pty-1')
    await h.open()
    h.leave()
    h.resume()
    await h.resized(PHONE, 'auto', 2)
    expect(h.shown).toBe(true)
  })

  it('failure: a resume claim that is refused or never answered lifts the cover after the timeout, and says so', async () => {
    const h = harness('pty-1')
    await h.open()
    h.leave()
    await h.resized(DESKTOP, 'desktop', 2)
    h.resume()
    act(() => {
      vi.advanceTimersByTime(TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS - 1)
    })
    expect(h.shown).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(h.shown).toBe(true)
    expect(logs.some((line) => String(line[0]).includes('first frame shown') && JSON.stringify(line[1]).includes('timeout'))).toBe(true)
  })

  it('does not lift the cover while the app is still away (no timeout before the resume)', async () => {
    const h = harness('pty-1')
    await h.open()
    h.leave()
    await h.resized(DESKTOP, 'desktop', 2)
    act(() => {
      vi.advanceTimersByTime(TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS * 4)
    })
    expect(h.shown).toBe(false)
  })

  it('a manual Desktop pick in the foreground is drawn at once, never covered', async () => {
    const h = harness('pty-1')
    await h.open()
    await h.resized(DESKTOP, 'desktop', 2)
    expect(h.visible).toEqual([{ cols: DESKTOP.cols, shown: true }])
  })

  it('degenerate: a pane the phone never showed is not shown by the resume alone', async () => {
    const h = harness('pty-1')
    h.leave()
    h.resume()
    expect(h.shown).toBe(false)
  })
})
