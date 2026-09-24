import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TERMINAL_GESTURE_PROBE_INTERVAL_MS,
  TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT,
  admitTerminalGestureRow,
  noteTerminalOutput,
  type TerminalGestureOutputWindow
} from './terminal-gesture-output-window'

function fill(handle: string, now: number) {
  const windows = new Map<string, TerminalGestureOutputWindow>()
  for (let i = 0; i < TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT; i += 1) {
    expect(admitTerminalGestureRow(windows, handle, now, 'down')).toBe(true)
  }
  return windows
}

describe('the wheel-row window a terminal gets between its outputs', () => {
  it('admits exactly the window, then refuses the next row', () => {
    const windows = fill('term_window', 1000)
    expect(admitTerminalGestureRow(windows, 'term_window', 1001, 'down')).toBe(false)
  })

  it('does not reopen for a chunk that was only the HUD beacon', () => {
    // consumeAgentHudBeacons hands back '' for a chunk that carried nothing
    // else; the beacon is the status-line child's write, not the agent's.
    const windows = fill('term_beacon_only', 1000)
    noteTerminalOutput('term_beacon_only', '')
    expect(admitTerminalGestureRow(windows, 'term_beacon_only', 1001, 'down')).toBe(false)
  })

  it('reopens in full once the program prints', () => {
    const windows = fill('term_prints', 1000)
    noteTerminalOutput('term_prints', 'x')
    for (let i = 0; i < TERMINAL_GESTURE_ROWS_WITHOUT_OUTPUT; i += 1) {
      expect(admitTerminalGestureRow(windows, 'term_prints', 1001, 'down')).toBe(true)
    }
    expect(admitTerminalGestureRow(windows, 'term_prints', 1001, 'down')).toBe(false)
  })

  it('lets one probe row through per interval, measured from the last row sent', () => {
    const windows = fill('term_probe', 1000)
    const due = 1000 + TERMINAL_GESTURE_PROBE_INTERVAL_MS
    expect(admitTerminalGestureRow(windows, 'term_probe', due - 1, 'down')).toBe(false)
    expect(admitTerminalGestureRow(windows, 'term_probe', due, 'down')).toBe(true)
    expect(admitTerminalGestureRow(windows, 'term_probe', due + 1, 'down')).toBe(false)
  })

  it('admits the first row of a reversal at once, and only that row', () => {
    const windows = fill('term_reverse', 1000)
    expect(admitTerminalGestureRow(windows, 'term_reverse', 1001, 'up')).toBe(true)
    expect(admitTerminalGestureRow(windows, 'term_reverse', 1002, 'up')).toBe(false)
    // A click or drag row carries no direction and is no reversal.
    expect(admitTerminalGestureRow(windows, 'term_reverse', 1003, null)).toBe(false)
  })

  it('keeps each terminal to its own window', () => {
    const windows = fill('term_a', 1000)
    expect(admitTerminalGestureRow(windows, 'term_b', 1001, 'down')).toBe(true)
  })

  it('counts output from the stream the terminal is subscribed on', () => {
    // A defect of wiring, with no behavioural handle short of mounting the whole
    // session: without this call every terminal would get 32 rows and then one
    // every half second, forever.
    const source = readFileSync(join(__dirname, 'use-mobile-session-terminal-subscription.ts'), 'utf8')
    const strip = source.indexOf('const chunk = consumeAgentHudBeacons(handle, data.chunk)')
    const note = source.indexOf('noteTerminalOutput(handle, chunk)')
    expect(strip).toBeGreaterThan(0)
    expect(note).toBeGreaterThan(strip)
  })
})
