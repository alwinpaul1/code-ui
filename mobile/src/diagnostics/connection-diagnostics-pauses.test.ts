import { describe, expect, it } from 'vitest'
import { appPauseLogEntry } from '../background/app-pause-detector'
import type { ConnectionLogEntry } from '../transport/types'
import { describeAppPauses } from './connection-diagnostics-pauses'
import { buildConnectionDiagnosticsReport } from './connection-diagnostics-report'

const HOUR = 3_600_000
const MINUTE = 60_000
const DAY = Date.UTC(2026, 8, 27)
const NOW = DAY + 14 * HOUR + 21 * MINUTE + 1_000

/** A pause entry exactly as the pause detector writes it into each host's log. */
function pause(fromMs: number, toMs: number): ConnectionLogEntry {
  return appPauseLogEntry(
    { from: DAY + fromMs, to: DAY + toMs },
    { serviceRunning: false, unrestricted: true },
    null
  )
}

function lanClose(atMs: number): ConnectionLogEntry {
  return {
    id: `log-closed-${atMs}`,
    ts: DAY + atMs,
    level: 'warn',
    message: 'WebSocket closed',
    detail: 'Close code 1006; reconnect scheduled',
    code: 'socket-closed',
    path: 'lan'
  }
}

/** The shape of the 2026-09-27 report's night: the log opens at 00:27:39, Android paused the
 *  app for an hour at a time, once for 2h 5m, and for 27 m before the user opened it. */
function reportedNight(): ConnectionLogEntry[] {
  return [
    lanClose(27 * MINUTE + 39_000),
    pause(30 * MINUTE, HOUR + 30 * MINUTE),
    pause(HOUR + 31 * MINUTE, 2 * HOUR + 31 * MINUTE),
    pause(2 * HOUR + 32 * MINUTE, 4 * HOUR + 37 * MINUTE),
    lanClose(4 * HOUR + 37 * MINUTE + 10_000),
    pause(13 * HOUR + 53 * MINUTE, 14 * HOUR + 20 * MINUTE)
  ]
}

describe('describeAppPauses', () => {
  it('adds up the pauses over the span the log covers', () => {
    expect(describeAppPauses(reportedNight(), NOW)).toBe(
      'Phone was paused by Android for 4h 32m of the last 14 hours (4 pauses)'
    )
  })

  it('says nothing when Android never paused the app', () => {
    expect(describeAppPauses([lanClose(HOUR)], NOW)).toBeNull()
    expect(describeAppPauses([], NOW)).toBeNull()
  })

  it('reads one short pause inside the last hour', () => {
    expect(describeAppPauses([pause(13 * HOUR + 53 * MINUTE, 14 * HOUR + 20 * MINUTE)], NOW)).toBe(
      'Phone was paused by Android for 27m of the last hour (1 pause)'
    )
  })

  it('counts a pause the log holds twice once', () => {
    const one = pause(13 * HOUR, 14 * HOUR)
    expect(describeAppPauses([one, { ...one }], NOW)).toBe(
      'Phone was paused by Android for 1h 0m of the last 2 hours (1 pause)'
    )
  })

  it('falls back to the written duration when the start time is missing, and skips an entry it cannot read', () => {
    const noSince: ConnectionLogEntry = {
      ...pause(13 * HOUR, 14 * HOUR),
      detail: 'Nothing ran for 1h 0m: no reconnects, no notifications.'
    }
    const unreadable: ConnectionLogEntry = { ...pause(10 * HOUR, 11 * HOUR), detail: undefined }

    expect(describeAppPauses([noSince], NOW)).toBe(
      'Phone was paused by Android for 1h 0m of the last 2 hours (1 pause)'
    )
    expect(describeAppPauses([unreadable], NOW)).toBeNull()
  })
})

// 2026-09-27: the report said "Connection is healthy via Relay" and nothing else, while its own
// history showed Android freezing the app for an hour at a time all night.
describe('the copied report while connected', () => {
  it('says how long Android paused the phone even though the host is connected', () => {
    const report = buildConnectionDiagnosticsReport({
      hostName: 'Host 1',
      endpoint: 'ws://192.168.137.1:6768',
      state: 'connected',
      reconnectAttempts: 0,
      lastConnectedAt: DAY + 14 * HOUR + 20 * MINUTE + 9_549,
      platform: 'android 37',
      appVersion: '0.9.54',
      activePath: 'relay',
      background: { serviceRunning: true, unrestricted: true },
      entries: reportedNight(),
      nowMs: NOW
    })

    expect(report).toContain('Likely cause: Connection is healthy via Relay.')
    expect(report).toContain(
      'Phone was paused by Android for 4h 32m of the last 14 hours (4 pauses)'
    )
  })

  it('adds no pause line when there were no pauses', () => {
    const report = buildConnectionDiagnosticsReport({
      hostName: 'Host 1',
      endpoint: 'ws://192.168.137.1:6768',
      state: 'connected',
      reconnectAttempts: 0,
      lastConnectedAt: NOW - MINUTE,
      platform: 'android 37',
      appVersion: '0.9.54',
      entries: [lanClose(HOUR)],
      nowMs: NOW
    })

    expect(report).not.toContain('paused by Android')
  })
})

describe('a pause line that names why the background service stopped', () => {
  it('is still counted as a pause, with its length read from the line', () => {
    const entry = appPauseLogEntry(
      { from: DAY + 12 * HOUR, to: DAY + 13 * HOUR },
      { serviceRunning: false, unrestricted: true },
      { at: DAY + 12 * HOUR + 53 * MINUTE, cause: 'task-ended' }
    )
    expect(describeAppPauses([entry], NOW)).toMatch(/1h/)
  })
})
