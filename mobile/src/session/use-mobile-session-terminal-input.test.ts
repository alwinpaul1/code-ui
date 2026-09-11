import { createElement, createRef, useRef, type MutableRefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalModes } from '../terminal/terminal-webview-contract'
import {
  TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS,
  TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES
} from './mobile-session-route-helpers'
import type { TerminalGestureInputQueue } from './mobile-session-route-types'
import { useMobileSessionTerminalInput } from './use-mobile-session-terminal-input'

/** One request that never answers, as the relay behaves for ~400 ms at a time. */
function pendingRequest(): Promise<never> {
  return new Promise<never>(() => {})
}

const HANDLE = 'term_claude'
const WHEEL_UP = '\x1b[<64;10;20M'
const WHEEL_DOWN = '\x1b[<65;10;20M'

type Hook = ReturnType<typeof useMobileSessionTerminalInput>

function mount(sendRequest: ReturnType<typeof vi.fn>) {
  const hookRef = createRef<Hook>() as MutableRefObject<Hook | null>
  const client = { sendRequest }
  function Harness() {
    const ptyModesRef = useRef(
      new Map<string, TerminalModes>([
        [
          HANDLE,
          {
            altScreen: true,
            mouseTrackingMode: 'any',
            sgrMouseMode: true,
            bracketedPasteMode: false
          } as TerminalModes
        ]
      ])
    )
    const scope = {
      client,
      connState: 'connected',
      toggleTerminalLiveInput: vi.fn(),
      activeHandle: HANDLE,
      ptyModesRef,
      terminalGestureInputQueuesRef: useRef(new Map<string, TerminalGestureInputQueue>()),
      terminalGestureInputInFlightRef: useRef(new Map<string, number>()),
      deviceTokenRef: useRef('device-token'),
      clientRef: useRef(client),
      connStateRef: useRef('connected'),
      liveInputRef: useRef(null),
      liveInputFocusTimerRef: useRef(null),
      terminalUnsubsRef: useRef(new Map()),
      activeHandleRef: useRef(HANDLE),
      activeSessionTabTypeRef: useRef('terminal'),
      clearPendingLiveInputCommit: vi.fn(),
      showToast: vi.fn(),
      getTerminalRef: vi.fn(),
      hostQueryReplyInputSupportedRef: useRef(false),
      hostPlatformRef: useRef('darwin')
    }
    hookRef.current = useMobileSessionTerminalInput(
      scope as unknown as Parameters<typeof useMobileSessionTerminalInput>[0]
    )
    return null
  }
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(createElement(Harness))
  })
  return { hookRef, renderer }
}

describe('scrolling a mouse-tracking TUI over a slow link', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps sending wheel reports while earlier ones are still unanswered', async () => {
    // Why: measured on a Galaxy S23 over Orca Relay, 2026-09-11 — with one
    // batch in flight at a time, Claude Code repainted in bursts ~410 ms
    // apart (p50 408 ms between painted frames), one per relay round trip.
    const sendRequest = vi.fn(() => pendingRequest())
    const { hookRef, renderer } = mount(sendRequest)

    for (let i = 0; i < 4; i += 1) {
      act(() => {
        hookRef.current!.handleTerminalInput(HANDLE, i % 2 ? WHEEL_DOWN : WHEEL_UP)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS + 1)
      })
    }

    expect(sendRequest).toHaveBeenCalledTimes(4)
    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual(
      Array(4).fill('terminal.send')
    )
    renderer.unmount()
  })

  it('paces a fling out one wheel row per flush and drops none of them', async () => {
    // Why: measured from the user's finger on 2026-09-11 (Galaxy S23, Orca
    // Relay): rows arrived at Claude faster than it repaints (~40/s), so 24 of
    // 47 repaints moved six or more rows at once — the "jumps" — and the token
    // bucket dropped whole batches past 64 rows, so the steps were uneven too.
    const sendRequest = vi.fn(() => pendingRequest())
    const { hookRef, renderer } = mount(sendRequest)

    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_UP.repeat(10))
    })
    // The first row leaves at once, the second one flush later, never a batch.
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS + 1)
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect((sendRequest.mock.calls[0] as unknown[])[1]).toMatchObject({ text: WHEEL_UP })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * 12)
    })
    expect(sendRequest).toHaveBeenCalledTimes(10)
    for (const call of sendRequest.mock.calls as unknown[][]) {
      expect(call[1]).toMatchObject({ text: WHEEL_UP })
    }
    renderer.unmount()
  })

  it('delivers every row of a long fling instead of dropping the batches past a bucket', async () => {
    const sendRequest = vi.fn(async () => ({}))
    const { hookRef, renderer } = mount(sendRequest)

    for (let i = 0; i < 12; i += 1) {
      act(() => {
        hookRef.current!.handleTerminalInput(HANDLE, WHEEL_UP.repeat(10))
      })
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * 130)
    })
    const rows = (sendRequest.mock.calls as unknown[][]).reduce(
      (n, call) => n + ((call[1] as { text: string }).text.split(WHEEL_UP).length - 1),
      0
    )
    // One row left at once; the other 96 waited their turn; the 23 past the cap
    // were the finger's extra travel, not a bucket emptying mid-swipe.
    expect(rows).toBe(TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES + 1)
    renderer.unmount()
  })

  it('sends a tap\'s click at once and whole, ahead of any wheel rows still queued', () => {
    // Why: press and release in one payload, now — behind 96 paced rows the
    // click landed 1.5 s late, and a full queue could keep the press and drop
    // the release, a held button (reviewed 2026-09-11).
    const sendRequest = vi.fn(() => pendingRequest())
    const { hookRef, renderer } = mount(sendRequest)
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_UP.repeat(30))
    })
    const CLICK = '\x1b[<0;10;20M\x1b[<0;10;20m'
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, CLICK)
    })
    const texts = (sendRequest.mock.calls as unknown[][]).map((call) => (call[1] as { text: string }).text)
    expect(texts).toContain(CLICK)
    renderer.unmount()
  })
})
