import { createElement, createRef, useRef, type MutableRefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalModes } from '../terminal/terminal-webview-contract'
import {
  TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS,
  TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES
} from './mobile-session-route-helpers'
import type { TerminalGestureInputQueue } from './mobile-session-route-types'
import {
  TERMINAL_GESTURE_PROBE_INTERVAL_MS,
  TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT,
  noteTerminalOutput
} from './terminal-gesture-output-window'
import { useMobileSessionTerminalInput } from './use-mobile-session-terminal-input'

/** One request that never answers, as the relay behaves for ~400 ms at a time. */
function pendingRequest(): Promise<never> {
  return new Promise<never>(() => {})
}

const HANDLE = 'term_claude'
const WHEEL_UP = '\x1b[<64;10;20M'
const WHEEL_DOWN = '\x1b[<65;10;20M'

/** Claude Code in fullscreen, as 2.1.280/2.1.281 set it up: `?1049h`, then
 *  `?1000h?1002h?1003h?1006h` (the binary's "full" mouse mode). */
const CLAUDE_FULLSCREEN_MODES: TerminalModes = {
  altScreen: true,
  mouseTrackingMode: 'any',
  sgrMouseMode: true,
  sgrMousePixelsMode: false,
  bracketedPasteMode: false
}

type Hook = ReturnType<typeof useMobileSessionTerminalInput>

function mount(
  sendRequest: ReturnType<typeof vi.fn>,
  modes: TerminalModes | null = CLAUDE_FULLSCREEN_MODES
) {
  const hookRef = createRef<Hook>() as MutableRefObject<Hook | null>
  const client = { sendRequest }
  function Harness() {
    const ptyModesRef = useRef(
      new Map<string, TerminalModes>(modes ? [[HANDLE, modes]] : [])
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

/** A program that repaints for every row it is sent, as Claude Code's
 *  fullscreen view does while it scrolls: each send is answered and the
 *  terminal's output stream carries a frame. */
function repaintingProgram() {
  return vi.fn(async () => {
    noteTerminalOutput(HANDLE, '\x1b[?2026h…frame…\x1b[?2026l')
    return {}
  })
}

function sentTexts(sendRequest: ReturnType<typeof vi.fn>): string[] {
  return (sendRequest.mock.calls as unknown[][]).map((call) => (call[1] as { text: string }).text)
}

/**
 * The desktop end of terminal.send, as it behaves on macOS while the program
 * is not reading its stdin. Orca's node-pty writer (the CustomWriteStream in
 * node-pty 1.1.0 as Orca.app ships it) hands each write to the kernel, which
 * takes what fits in the pty's input queue; the rest stays in Orca and is
 * retried until the program reads. Measured 2026-09-24 on Darwin 27.0.0 with a
 * raw, unread pty: the queue holds 1022 bytes, and the 86th 12-byte wheel
 * report was cut after `ESC[`, leaving `<64;19;15M` outside.
 */
function stalledPtyInputQueue(capacity = 1022) {
  let queued = 0
  let backlog = false
  const strandedTails: string[] = []
  const sendRequest = vi.fn(async (_method: string, params: { text: string }) => {
    if (backlog) {
      return {}
    }
    const room = capacity - queued
    if (params.text.length <= room) {
      queued += params.text.length
    } else {
      queued = capacity
      backlog = true
      strandedTails.push(params.text.slice(room))
    }
    return {}
  })
  return { sendRequest, strandedTails, queuedBytes: () => queued }
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
    const sendRequest = repaintingProgram()
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
    // were the oldest of the finger's travel, not a bucket emptying mid-swipe.
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

  it('keeps the newest rows when a fling overflows the queue, so the scroll reaches its end', async () => {
    // Why: Claude Code's sticky header stayed up after a fling back down —
    // the queue had kept the fling's first rows and dropped its tail, so the
    // agent stopped a few rows short of its bottom (2026-09-11).
    const sendRequest = repaintingProgram()
    const { hookRef, renderer } = mount(sendRequest)
    const TAGGED = (n: number) => `\x1b[<65;${n};20M`
    // The native view hands over at most 32 rows per event; a fling is several.
    for (let batch = 0; batch < 5; batch += 1) {
      act(() => {
        hookRef.current!.handleTerminalInput(
          HANDLE,
          Array.from({ length: 26 }, (_, i) => TAGGED(batch * 26 + i + 1)).join('')
        )
      })
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * 140)
    })
    const texts = (sendRequest.mock.calls as unknown[][]).map((call) => (call[1] as { text: string }).text)
    expect(texts).toContain(TAGGED(130))
    expect(texts).not.toContain(TAGGED(2))
    renderer.unmount()
  })

  it('drops the queued rows of the old direction when the finger reverses', async () => {
    const sendRequest = vi.fn(async () => ({}))
    const { hookRef, renderer } = mount(sendRequest)
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_UP.repeat(20))
    })
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_DOWN.repeat(3))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * 30)
    })
    const texts = (sendRequest.mock.calls as unknown[][]).map((call) => (call[1] as { text: string }).text)
    const ups = texts.filter((text) => text === WHEEL_UP).length
    const downs = texts.filter((text) => text === WHEEL_DOWN).length
    expect(downs).toBe(3)
    expect(ups).toBeLessThanOrEqual(1)
    renderer.unmount()
  })
})

/**
 * What typed `<64;19;15M4;19;15M<64;19;15M` into Claude Code's prompt
 * (reported from the phone, 2026-09-24). Claude Code's own stdin reader, cut
 * from the 2.1.280 and 2.1.281 binaries and replayed with timed arrivals, reads
 * a whole wheel report as a wheel event every time, mouse mode on or off. It
 * types text only when one report reaches it in two reads: cut after `ESC[`,
 * the tail `<64;19;15M` is typed if it lands 2 s or more after the head; cut
 * after `ESC[<6`, `4;19;15M` is typed at 4 s or more. The phone's sends are
 * whole; the cut is the desktop pty's input queue filling while the program is
 * not reading, with the phone still sending.
 */
describe('scrolling a program that has stopped reading its input', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('never lets a fling overfill the pty, which cut <64;19;15M off a wheel report', async () => {
    const pty = stalledPtyInputQueue()
    const { hookRef, renderer } = mount(pty.sendRequest)
    // The screenshot's cell: column 19, row 15.
    const REPORT = '\x1b[<64;19;15M'
    for (let i = 0; i < 12; i += 1) {
      act(() => {
        hookRef.current!.handleTerminalInput(HANDLE, REPORT.repeat(10))
      })
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * 130)
    })
    // Before the fix all 97 rows went (1164 bytes) and the 86th was cut after
    // `ESC[`, leaving exactly the screenshot's first fragment stranded.
    expect(pty.strandedTails).toEqual([])
    expect(sentTexts(pty.sendRequest).every((text) => text === REPORT)).toBe(true)
    expect(pty.sendRequest).toHaveBeenCalledTimes(TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT)
    renderer.unmount()
  })

  it('scrolls again as soon as the program prints after a stall', async () => {
    const sendRequest = vi.fn(async () => ({}))
    const { hookRef, renderer } = mount(sendRequest)
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_UP.repeat(32))
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_UP.repeat(32))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * 70)
    })
    expect(sendRequest).toHaveBeenCalledTimes(TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT)
    noteTerminalOutput(HANDLE, 'repaint')
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_DOWN)
    })
    expect(sendRequest).toHaveBeenCalledTimes(TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT + 1)
    expect(sentTexts(sendRequest).at(-1)).toBe(WHEEL_DOWN)
    renderer.unmount()
  })

  it('offers a silent program one row per interval, so a scroll off its end is not stuck', async () => {
    // At the end of a transcript a wheel row changes nothing and paints
    // nothing, so silence alone cannot tell a stalled program from one with
    // nowhere to go. A probe row reaches it; its repaint reopens the window.
    const sendRequest = vi.fn(async () => ({}))
    const { hookRef, renderer } = mount(sendRequest)
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_DOWN.repeat(32))
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_DOWN.repeat(32))
    })
    // The window fills at the last row it admits; the finger's next row, a
    // moment later, is refused.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * (TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT + 2)
      )
    })
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_DOWN)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * 2)
    })
    expect(sendRequest).toHaveBeenCalledTimes(TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_PROBE_INTERVAL_MS)
    })
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_DOWN.repeat(5))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * 10)
    })
    expect(sendRequest).toHaveBeenCalledTimes(TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT + 1)
    expect(sentTexts(sendRequest).at(-1)).toBe(WHEEL_DOWN)
    renderer.unmount()
  })

  it('scrolls back at once after a fling runs off the end of the transcript', async () => {
    // Reviewed 2026-09-24: at the bottom a wheel-down paints nothing, so the
    // window closes on rows that went nowhere; the finger's reversal then sat
    // dead for up to 500 ms and its rows were thrown away. Wheel-up at the
    // bottom does scroll, and Claude Code repaints.
    const sendRequest = vi.fn(async (_method: string, params: { text: string }) => {
      if (params.text === WHEEL_UP) {
        noteTerminalOutput(HANDLE, 'repaint')
      }
      return {}
    })
    const { hookRef, renderer } = mount(sendRequest)
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_DOWN.repeat(32))
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_DOWN.repeat(32))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * (TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT + 2)
      )
    })
    expect(sendRequest).toHaveBeenCalledTimes(TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT)
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, WHEEL_UP.repeat(10))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * 2)
    })
    expect(sentTexts(sendRequest).filter((text) => text === WHEEL_UP).length).toBeGreaterThan(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * 12)
    })
    expect(sentTexts(sendRequest).filter((text) => text === WHEEL_UP)).toHaveLength(10)
    renderer.unmount()
  })

  it('holds a fling for a program whose repaint lags, rather than cutting it at the window', async () => {
    // Reviewed 2026-09-24: with each row's paint landing 600 ms after it was
    // sent, the window filled before the first paint came back and the rest of
    // the fling was dropped, 32 rows of 97. Rows kept on the phone cost the
    // pty nothing; they go once the program shows it is reading.
    const sendRequest = vi.fn(async () => {
      setTimeout(() => noteTerminalOutput(HANDLE, 'repaint'), 600)
      return {}
    })
    const { hookRef, renderer } = mount(sendRequest)
    for (let i = 0; i < 12; i += 1) {
      act(() => {
        hookRef.current!.handleTerminalInput(HANDLE, WHEEL_UP.repeat(10))
      })
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS * 200)
    })
    expect(sendRequest).toHaveBeenCalledTimes(TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES + 1)
    renderer.unmount()
  })
})

describe('sending only the reports the program asked for, in its encoding', () => {
  const SGR_WHEEL = '\x1b[<64;19;15M'
  // The same wheel-up at column 19, row 15 in the default (X10) encoding.
  const DEFAULT_WHEEL = '\x1b[M`3/'
  const MOUSE_OFF_FULLSCREEN: TerminalModes = {
    ...CLAUDE_FULLSCREEN_MODES,
    mouseTrackingMode: 'none',
    sgrMouseMode: false
  }

  function sendsFor(modes: TerminalModes | null, bytes: string): string[] {
    const sendRequest = vi.fn(async () => ({}))
    const { hookRef, renderer } = mount(sendRequest, modes)
    act(() => {
      hookRef.current!.handleTerminalInput(HANDLE, bytes)
    })
    renderer.unmount()
    return sentTexts(sendRequest)
  }

  it('does not send wheel reports to a full-screen program with mouse reporting off', () => {
    // Claude Code writes `?1006l?1003l?1002l?1000l` when it lets go of the
    // mouse and stays on the alternate screen; the old gate let any gesture
    // byte through on the alternate screen alone.
    expect(sendsFor(MOUSE_OFF_FULLSCREEN, SGR_WHEEL)).toEqual([])
  })

  it('does not send SGR reports to a program that asked for the default encoding', () => {
    const defaultEncoding = { ...CLAUDE_FULLSCREEN_MODES, sgrMouseMode: false }
    expect(sendsFor(defaultEncoding, SGR_WHEEL)).toEqual([])
    expect(sendsFor(defaultEncoding, DEFAULT_WHEEL)).toEqual([DEFAULT_WHEEL])
  })

  it('does not send default-encoded mouse bytes to a program that asked for SGR', () => {
    expect(sendsFor(CLAUDE_FULLSCREEN_MODES, DEFAULT_WHEEL)).toEqual([])
    expect(sendsFor(CLAUDE_FULLSCREEN_MODES, SGR_WHEEL)).toEqual([SGR_WHEEL])
  })

  it('does not type arrow keys for a scroll while the program owns the mouse', () => {
    expect(sendsFor(CLAUDE_FULLSCREEN_MODES, '\x1b[B')).toEqual([])
    // less, vim, man: full screen, no mouse, the scroll is theirs as keys.
    expect(sendsFor(MOUSE_OFF_FULLSCREEN, '\x1b[B')).toEqual(['\x1b[B'])
  })

  it("sends nothing before the program's modes are known", () => {
    expect(sendsFor(null, SGR_WHEEL)).toEqual([])
    expect(sendsFor(null, '\x1b[B')).toEqual([])
  })

  it('still scrolls a full-screen X10 program with arrow keys, since X10 reports no wheel', () => {
    // DEC 9 reports button presses only; the WebView engine scrolls such a
    // program with cursor keys, and a click is still a press report.
    const x10 = { ...MOUSE_OFF_FULLSCREEN, mouseTrackingMode: 'x10' as const }
    expect(sendsFor(x10, '\x1b[B')).toEqual(['\x1b[B'])
    expect(sendsFor(x10, '\x1b[M 3/')).toEqual(['\x1b[M 3/'])
    expect(sendsFor(x10, DEFAULT_WHEEL)).toEqual([])
  })

  it("sends a default-encoded tap's press and release together, so no button is left held", () => {
    // Reviewed 2026-09-24: only SGR clicks took the one-send path; a default
    // click rode the paced queue, where the wheel window could let the press
    // through and hold back the release.
    const CLICK = '\x1b[M 3/\x1b[M#3/'
    const defaultEncoding = { ...CLAUDE_FULLSCREEN_MODES, sgrMouseMode: false }
    expect(sendsFor(defaultEncoding, CLICK)).toEqual([CLICK])
  })
})
