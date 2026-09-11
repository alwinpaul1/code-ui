import { createElement, createRef, useRef, type MutableRefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalModes } from '../terminal/terminal-webview-contract'
import { TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS } from './mobile-session-route-helpers'
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
      terminalGestureInputBucketsRef: useRef(new Map()),
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
})
