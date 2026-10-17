// Reported from the phone on 0.9.132 (2026-10-13, screen recording): "Opens in
// desktop and flashes and changes to mobile." Tapping a worktree opened
// Terminal 1 (an Antigravity tab) with an empty body, then the WebView's own
// blank background, then the terminal's text: two visible hand-offs before
// one settled screen, repeated on every re-entry.
//
// The pane must stay covered until the first frame it can keep is in it: the
// host's frame at the phone's size, or the reason none is coming (the fit
// cannot be measured, the re-subscribe is refused, the stream ends, the
// host never answers). These drive the session's real stream handler and
// read what it says about the pane, with xterm reduced to the calls it gets.
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalViewportResubscribeBudget } from './mobile-terminal-viewport-resubscribe'
import { useMobileSessionTerminalSubscription } from './use-mobile-session-terminal-subscription'
import {
  TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS,
  useTerminalFirstFrameReveal
} from '../terminal/terminal-first-frame-reveal'

/** The phone viewport the S23 measured in the recording's layout (51 columns of mono). */
const PHONE = { cols: 51, rows: 38 }
/** The desktop's PTY before the phone asked for its size. */
const DESKTOP = { cols: 160, rows: 48 }

type StreamEvent = Record<string, unknown>

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve()
    }
  })
}

function harness(
  handle: string,
  options: {
    measure?: () => Promise<{ cols: number; rows: number } | null>
    viewportMeasured?: boolean
    subscribeThrows?: boolean
  } = {}
) {
  const streams: Array<(event: StreamEvent) => void> = []
  const painted: Array<{ cols: number; rows: number; data: string; revealedBefore: boolean }> = []
  let reveal!: ReturnType<typeof useTerminalFirstFrameReveal>
  const client = {
    subscribe: vi.fn((_method: string, _params: unknown, onData: (event: StreamEvent) => void) => {
      streams.push(onData)
      return () => {}
    })
  }
  const pane = {
    init: vi.fn((cols: number, rows: number, data?: string) => {
      painted.push({ cols, rows, data: data ?? '', revealedBefore: reveal.revealedTerminalHandles.has(handle) })
    }),
    write: vi.fn(),
    resize: vi.fn(),
    resetZoom: vi.fn(),
    awaitReady: vi.fn(async () => {}),
    measureFitDimensions: vi.fn(options.measure ?? (async () => ({ ...PHONE })))
  }
  const terminalUnsubsRef = { current: new Map<string, () => void>() }
  const subscribingHandlesRef = { current: new Set<string>() }
  const subscribeSeqRef = { current: new Map<string, number>() }
  const webReadyHandlesRef = { current: new Set([handle]) }
  const unsubscribeTerminal = (h: string) => {
    terminalUnsubsRef.current.get(h)?.()
    terminalUnsubsRef.current.delete(h)
    subscribingHandlesRef.current.delete(h)
    subscribeSeqRef.current.set(h, (subscribeSeqRef.current.get(h) ?? 0) + 1)
  }
  const scope = {
    client,
    clientId: 'phone',
    setTerminalModes: vi.fn(),
    terminalCwdRef: { current: new Map() },
    viewportRef: { current: options.viewportMeasured === false ? null : { ...PHONE } },
    viewportMeasuredRef: { current: options.viewportMeasured !== false },
    terminalUnsubsRef,
    subscribingHandlesRef,
    leaseOnlyHandlesRef: { current: new Set<string>() },
    initializedHandlesRef: { current: new Set<string>() },
    terminalDiagnosticsRef: { current: new Proxy({}, { get: () => () => {} }) },
    viewportResubscribeBudgetRef: { current: new TerminalViewportResubscribeBudget() },
    webReadyHandlesRef,
    activeHandleRef: { current: handle },
    subscribeSeqRef,
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
  return {
    pane,
    painted,
    streams,
    webReadyHandlesRef,
    get shown() {
      return reveal.revealedTerminalHandles.has(handle)
    },
    subscribe: () => act(() => subscribeToTerminal(handle)),
    emit: (event: StreamEvent, stream = streams.length - 1) =>
      act(() => {
        streams[stream]?.(event)
      })
  }
}

function scrollback(dims: { cols: number; rows: number }, serialized: string, extra: StreamEvent = {}): StreamEvent {
  return { type: 'scrollback', cols: dims.cols, rows: dims.rows, serialized, seq: 1, ...extra }
}

// The Antigravity screen in the recording (Gemini 3.8 Flash), its last rows.
const AGY_SCREEN = [
  'The master runner daemon is actively running',
  'and progressing through the training backlog.',
  '> ',
  ' • [18:41:53] python3 /Users/alwinpaul/... running',
  '? for shortcuts            Gemini 3.8 Flash · medium'
].join('\r\n')

// A Claude Code 2.1.280 prompt row and its footer.
const CLAUDE_SCREEN = ['❯ ', '  ⏵⏵ accept edits on (shift+tab to cycle)'].join('\r\n')

describe('opening a terminal tab paints one phone-size frame', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps a Claude terminal tab covered through the desktop-width frame and shows it at the phone width', async () => {
    const h = harness('pty-claude')
    h.subscribe()
    // The host answered before it had applied the phone's size.
    h.emit(scrollback(DESKTOP, CLAUDE_SCREEN))
    await flush()
    expect(h.shown).toBe(false)
    // The fit pass re-subscribes with the phone viewport; that frame is phone-size.
    expect(h.streams).toHaveLength(2)
    h.emit(scrollback(PHONE, CLAUDE_SCREEN))
    await flush()
    expect(h.shown).toBe(true)
    // Nothing was ever on screen at the desktop width.
    expect(h.painted.filter((p) => p.cols === DESKTOP.cols).every((p) => !p.revealedBefore)).toBe(true)
  })

  it('shows an Antigravity tab as soon as its first frame is already phone-size', async () => {
    const h = harness('pty-antigravity')
    h.subscribe()
    expect(h.shown).toBe(false)
    h.emit(scrollback(PHONE, AGY_SCREEN))
    await flush()
    expect(h.shown).toBe(true)
    expect(h.streams).toHaveLength(1)
  })

  it('degenerate: shows a tab whose buffer is empty', async () => {
    const h = harness('pty-empty')
    h.subscribe()
    h.emit(scrollback(PHONE, ''))
    await flush()
    expect(h.pane.init).toHaveBeenCalledWith(PHONE.cols, PHONE.rows, '', false, undefined)
    expect(h.shown).toBe(true)
  })

  it('shows the content when the phone size cannot be measured, rather than staying covered', async () => {
    const h = harness('pty-claude', { viewportMeasured: false, measure: async () => null })
    h.subscribe()
    h.emit(scrollback(DESKTOP, CLAUDE_SCREEN))
    await flush()
    expect(h.shown).toBe(true)
  })

  it('shows the content when the fit pass fails outright (measure rejects)', async () => {
    const h = harness('pty-antigravity', { measure: async () => {
      throw new Error('webview gone')
    } })
    h.subscribe()
    h.emit(scrollback(DESKTOP, AGY_SCREEN))
    await flush()
    expect(h.shown).toBe(true)
  })

  it('shows the content when the re-subscribe for the phone size is turned away', async () => {
    const h = harness('pty-antigravity')
    h.subscribe()
    // The WebView reloads between the measure and the re-subscribe: its gate refuses.
    h.pane.measureFitDimensions.mockImplementation(async () => {
      h.webReadyHandlesRef.current.clear()
      return { ...PHONE }
    })
    h.emit(scrollback(DESKTOP, AGY_SCREEN))
    await flush()
    expect(h.streams).toHaveLength(1)
    expect(h.shown).toBe(true)
  })

  it('shows the content when the host keeps answering at another size', async () => {
    const h = harness('pty-claude')
    h.subscribe()
    h.emit(scrollback(DESKTOP, CLAUDE_SCREEN))
    await flush()
    expect(h.shown).toBe(false)
    // The re-subscribe's frame is still not phone-size: the next try backs off,
    // and the screen shows what it has rather than a cover for 750 ms.
    h.emit(scrollback(DESKTOP, CLAUDE_SCREEN))
    await flush()
    expect(h.shown).toBe(true)
  })

  it('shows a tab the user put in desktop mode at its desktop width at once', async () => {
    const h = harness('pty-antigravity')
    h.subscribe()
    h.emit(scrollback(DESKTOP, AGY_SCREEN, { displayMode: 'desktop' }))
    await flush()
    expect(h.shown).toBe(true)
  })

  it('shows the pane when a server resize lands before any scrollback is kept', async () => {
    const h = harness('pty-claude')
    h.subscribe()
    h.emit(scrollback(DESKTOP, CLAUDE_SCREEN))
    await flush()
    h.emit({ type: 'resized', cols: PHONE.cols, rows: PHONE.rows, serialized: CLAUDE_SCREEN, seq: 2 }, 1)
    await flush()
    expect(h.shown).toBe(true)
  })

  it('shows the pane when the stream ends before a frame', async () => {
    const h = harness('pty-claude')
    h.subscribe()
    h.emit({ type: 'error' })
    await flush()
    expect(h.shown).toBe(true)
  })

  it('shows the pane once the timeout passes when the host never sends a frame', async () => {
    const h = harness('pty-antigravity')
    h.subscribe()
    await act(async () => {
      vi.advanceTimersByTime(TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS - 1)
    })
    expect(h.shown).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(h.shown).toBe(true)
  })

  it('never covers a pane again once it is shown, so a later re-subscribe leaves typing and scrolling on screen', async () => {
    const h = harness('pty-claude')
    h.subscribe()
    h.emit(scrollback(PHONE, CLAUDE_SCREEN))
    await flush()
    expect(h.shown).toBe(true)
    // A reconnect re-subscribes and the host's first frame is momentarily wide.
    h.emit(scrollback(DESKTOP, CLAUDE_SCREEN))
    await flush()
    expect(h.shown).toBe(true)
  })

  it('keeps the cover until the WebView has painted the phone-size frame, not just been handed it', async () => {
    // Opus review: lifting the cover in the tick init() is posted shows the
    // blank WebView for as long as the document's first init takes.
    const h = harness('pty-antigravity')
    let painted!: () => void
    h.pane.awaitReady.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          painted = resolve
        })
    )
    h.subscribe()
    h.emit(scrollback(PHONE, AGY_SCREEN))
    await flush()
    expect(h.shown).toBe(false)
    await act(async () => {
      painted()
    })
    await flush()
    expect(h.shown).toBe(true)
  })

  // 2026-10-17, logcat on the S23: every pane since 15:58 read "first frame shown
  // reason: 'timeout'", the Claude tabs (chat view) and JETCAS/TACO alike. The
  // hook armed its 2.5 s backstop for the ACTIVE handle on its own, chat or no
  // chat; under the chat the covered stream never reveals, so the timer lifted
  // the cover behind the chat, and showing the terminal later drew the blank
  // WebView and the desk-width frame the cover exists to hide. The backstop for
  // a shown terminal is the view switch's (use-mobile-session-view-switch.test.tsx).
  it('keeps the terminal under a chat covered past the timeout, so showing it later still waits for its frame', async () => {
    let reveal!: ReturnType<typeof useTerminalFirstFrameReveal>
    // The screen state's call as it was, the active handle and no word on the chat.
    const useReveal = useTerminalFirstFrameReveal as (
      activeHandle: string | null
    ) => ReturnType<typeof useTerminalFirstFrameReveal>
    function Screen({ activeHandle }: { activeHandle: string | null }) {
      reveal = useReveal(activeHandle)
      return null
    }
    act(() => {
      create(createElement(Screen, { activeHandle: 'pty-claude' }))
    })
    await act(async () => {
      vi.advanceTimersByTime(TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS * 2)
    })
    expect(reveal.revealedTerminalHandles.has('pty-claude')).toBe(false)

    // Shown: the backstop starts now, not from when the tab opened.
    act(() => {
      reveal.armTerminalFirstFrameRevealTimeout('pty-claude')
    })
    await act(async () => {
      vi.advanceTimersByTime(TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS - 1)
    })
    expect(reveal.revealedTerminalHandles.has('pty-claude')).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(reveal.revealedTerminalHandles.has('pty-claude')).toBe(true)
  })

  // Review 2026-10-17: a backstop armed while the terminal was on screen kept running
  // after the chat covered it, and lifted the cover behind the chat.
  it('keeps a terminal covered when the chat comes over it before its backstop runs out', async () => {
    let reveal!: ReturnType<typeof useTerminalFirstFrameReveal>
    function Screen() {
      reveal = useTerminalFirstFrameReveal()
      return null
    }
    act(() => {
      create(createElement(Screen))
    })
    act(() => {
      reveal.armTerminalFirstFrameRevealTimeout('pty-claude')
    })
    await act(async () => {
      vi.advanceTimersByTime(TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS - 1)
    })
    act(() => {
      reveal.cancelTerminalFirstFrameRevealTimeout('pty-claude')
    })
    await act(async () => {
      vi.advanceTimersByTime(TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS * 2)
    })
    expect(reveal.revealedTerminalHandles.has('pty-claude')).toBe(false)

    // Shown again: a fresh backstop, the full wait from now.
    act(() => {
      reveal.armTerminalFirstFrameRevealTimeout('pty-claude')
    })
    await act(async () => {
      vi.advanceTimersByTime(TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS)
    })
    expect(reveal.revealedTerminalHandles.has('pty-claude')).toBe(true)
  })

  it('degenerate: cancelling a pane with no backstop, or one already shown, changes nothing', async () => {
    let reveal!: ReturnType<typeof useTerminalFirstFrameReveal>
    function Screen() {
      reveal = useTerminalFirstFrameReveal()
      return null
    }
    act(() => {
      create(createElement(Screen))
    })
    act(() => {
      reveal.cancelTerminalFirstFrameRevealTimeout('never-armed')
      reveal.revealTerminalFirstFrame('pty-shown', 'converged')
      reveal.cancelTerminalFirstFrameRevealTimeout('pty-shown')
    })
    expect(reveal.revealedTerminalHandles.has('never-armed')).toBe(false)
    expect(reveal.revealedTerminalHandles.has('pty-shown')).toBe(true)
  })
})
