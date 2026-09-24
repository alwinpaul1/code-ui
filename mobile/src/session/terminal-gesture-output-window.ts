/**
 * Why wheel rows wait for the program to show it is reading them.
 *
 * On 2026-09-24 the phone typed `<64;19;15M4;19;15M<64;19;15M` and `[1B3` into
 * Claude Code's prompt on the desktop. Every row the phone sends is one whole
 * report in one terminal.send, and Claude Code's stdin reader (2.1.280 and
 * 2.1.281, replayed from the shipped binaries) reads a whole report as a wheel
 * event every time. It types text only when a report reaches it in two reads
 * with the tail seconds late: 2 s after an `ESC[` head, 4 s after `ESC[<6`.
 *
 * The cut is the desktop's pty. Orca's node-pty writer hands each write to the
 * kernel, which takes what fits in the pty's input queue and leaves the rest in
 * Orca until the program reads. On macOS (Darwin 27.0.0, measured 2026-09-24)
 * that queue holds 1022 bytes: 85 wheel reports and two bytes of the 86th,
 * `ESC[`, with `<64;19;15M` left outside, the screenshot's first fragment. The
 * queue only fills while the program is not reading. terminal.send answers as
 * soon as Orca has queued the write, so a reply says nothing about whether the
 * program took the bytes, and one long fling (the row sent at once and the 96
 * the queue keeps) is 1164 bytes on its own.
 *
 * What does show the program read: it paints. Claude Code repaints for a wheel
 * row it scrolls on. So a terminal gets at most
 * TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT rows past the last output the phone has
 * seen from it, 32 rows of at most 17 bytes (`ESC[<65;9999;9999M`) and under
 * 550 bytes, well inside the queue even with a relay's worth of rows still
 * travelling. At the end of a transcript a row paints nothing, so a closed
 * window still lets one probe row through per TERMINAL_GESTURE_PROBE_INTERVAL_MS,
 * and at once when the finger reverses: if the program is alive its repaint
 * reopens the window. Rows the window holds back wait on the phone, where
 * they cost the pty nothing, and are dropped once the finger has been still
 * for the queue's max age.
 */
export const TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT = 32
export const TERMINAL_GESTURE_PROBE_INTERVAL_MS = 500

/** Non-empty output chunks seen per terminal: the program's proof of life. */
const outputCounts = new Map<string, number>()

/** Called for every PTY data chunk after the HUD beacon is stripped from it. A
 *  chunk that was only the beacon is left out: the beacon is written by the
 *  agent's status-line child, not by the agent's own loop. */
export function noteTerminalOutput(handle: string, chunk: string): void {
  if (chunk.length === 0) {
    return
  }
  outputCounts.set(handle, (outputCounts.get(handle) ?? 0) + 1)
}

export type TerminalGestureOutputWindow = {
  /** The output count when the window last opened. */
  readonly outputCount: number
  /** Rows sent since then. */
  readonly rows: number
  readonly lastRowAt: number
  /** Which way the last row sent scrolled, when it was a wheel or arrow row. */
  readonly lastDirection: 'up' | 'down' | null
}

/**
 * Whether one more row scrolling `direction` may go to `handle` now; records
 * it when it may. A closed window still admits a probe per interval, and at
 * once when the finger reverses: a fling off the end of a transcript fills the
 * window with rows that painted nothing, and the scroll back is the row that
 * will paint. A reversal comes at a finger's pace, one row each.
 */
export function admitTerminalGestureRow(
  windows: Map<string, TerminalGestureOutputWindow>,
  handle: string,
  now: number,
  direction: 'up' | 'down' | null
): boolean {
  const outputCount = outputCounts.get(handle) ?? 0
  const current = windows.get(handle)
  const window =
    current && current.outputCount === outputCount
      ? current
      : { outputCount, rows: 0, lastRowAt: Number.NEGATIVE_INFINITY, lastDirection: null }
  const reversal =
    direction !== null && window.lastDirection !== null && direction !== window.lastDirection
  if (
    window.rows >= TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT &&
    now - window.lastRowAt < TERMINAL_GESTURE_PROBE_INTERVAL_MS &&
    !reversal
  ) {
    return false
  }
  windows.set(handle, {
    outputCount,
    rows: window.rows + 1,
    lastRowAt: now,
    lastDirection: direction ?? window.lastDirection
  })
  return true
}
