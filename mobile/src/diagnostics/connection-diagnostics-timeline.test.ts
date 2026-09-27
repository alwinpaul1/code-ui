import { describe, expect, it } from 'vitest'
import type { ConnectionLogEntry } from '../transport/types'
import {
  buildConnectionTimeline,
  formatClock,
  liveConnectionRow,
  type TimelineRow
} from './connection-diagnostics-timeline'
import {
  localTime,
  REPORTED_LAST_CONNECTED_AT,
  reportedLogTail
} from './connection-diagnostics-timeline.test-fixture'

/** When the screen is read: a minute after the relay connected, on the report's day. */
const NOW = localTime(14, 21, 1)

/** A log entry as the transport writes it once entries carry which client wrote them. */
type EntryWithClient = ConnectionLogEntry & { clientGeneration?: number }

function summarize(rows: readonly TimelineRow[]): string[] {
  return rows.map((row) =>
    row.kind === 'entry'
      ? `${formatClock(row.entry.ts)} ${row.entry.message}${row.client === null ? '' : ` [client ${row.client}]`}`
      : `${formatClock(row.ts)} ${row.text}${row.client === null ? '' : ` [client ${row.client}]`} (${row.entries.length} lines)`
  )
}

function closed(id: string, ts: number): ConnectionLogEntry {
  return {
    id,
    ts,
    level: 'warn',
    message: 'WebSocket closed',
    detail: 'Close code 1006; reconnect scheduled',
    code: 'socket-closed',
    path: 'lan'
  }
}

function scheduled(id: string, ts: number, delayMs: number, attempt: number): ConnectionLogEntry {
  return {
    id,
    ts,
    level: 'info',
    message: `Reconnect scheduled in ${delayMs}ms`,
    detail: `Attempt ${attempt}`,
    code: 'retry-scheduled',
    path: 'lan'
  }
}

function reconnecting(id: string, ts: number, attempt: number): ConnectionLogEntry {
  return {
    id,
    ts,
    level: 'info',
    message: `Reconnecting (attempt ${attempt})`,
    detail: '192.168.1.20:6768',
    path: 'lan'
  }
}

// 2026-09-27: the screen's header said "connected · healthy via Relay" while the visible tail of
// its timeline was nothing but LAN failures, because a healthy relay goes quiet after "migrated
// to relay" and the direct path's retry loop keeps writing.
describe('the pinned live-state row', () => {
  it('says the host is connected via the relay, and since when, above a tail of LAN failures', () => {
    expect(
      liveConnectionRow({
        nowMs: NOW,
        state: 'connected',
        activePath: 'relay',
        lastConnectedAt: REPORTED_LAST_CONNECTED_AT,
        entries: reportedLogTail()
      })
    ).toEqual({ tone: 'success', text: 'Connected via Relay since 14:20:09' })
  })

  it('names Wi-Fi and Tailscale for the direct paths', () => {
    const lastConnectedAt = localTime(9, 5, 1)
    expect(
      liveConnectionRow({
        nowMs: NOW,
        state: 'connected',
        activePath: 'lan',
        lastConnectedAt,
        entries: []
      }).text
    ).toBe('Connected via Wi-Fi since 09:05:01')
    expect(
      liveConnectionRow({
        nowMs: NOW,
        state: 'connected',
        activePath: 'tailscale',
        lastConnectedAt,
        entries: []
      }).text
    ).toBe('Connected via Tailscale since 09:05:01')
  })

  it('leaves out "since" when the client does not know when it connected', () => {
    expect(
      liveConnectionRow({
        nowMs: NOW,
        state: 'connected',
        activePath: 'relay',
        lastConnectedAt: null,
        entries: []
      })
    ).toEqual({ tone: 'success', text: 'Connected via Relay' })
  })

  it('dates a drop from the first failure on the path it was connected over, not a LAN failure under a live relay', () => {
    const drop: ConnectionLogEntry = {
      id: 'relay-drop',
      ts: localTime(14, 30, 0),
      level: 'error',
      message: 'Relay: active relay session failed',
      detail: 'Error: relay_outer_1006 (Software caused connection abort)',
      code: 'relay-session-failed',
      path: 'relay'
    }
    expect(
      liveConnectionRow({
        nowMs: NOW,
        state: 'reconnecting',
        activePath: 'relay',
        lastConnectedAt: REPORTED_LAST_CONNECTED_AT,
        entries: [...reportedLogTail(), drop]
      })
    ).toEqual({ tone: 'warning', text: 'Not connected since 14:30:00 · reconnecting' })
  })

  it('says when it last connected when the drop itself is not in the log', () => {
    expect(
      liveConnectionRow({
        nowMs: NOW,
        state: 'disconnected',
        activePath: 'relay',
        lastConnectedAt: REPORTED_LAST_CONNECTED_AT,
        entries: []
      })
    ).toEqual({ tone: 'danger', text: 'Not connected · last connected 14:20:09' })
  })

  it('says only "Not connected" for a host that never connected and an empty log', () => {
    expect(
      liveConnectionRow({
        nowMs: NOW,
        state: 'disconnected',
        activePath: 'lan',
        lastConnectedAt: null,
        entries: []
      })
    ).toEqual({ tone: 'danger', text: 'Not connected' })
    expect(
      liveConnectionRow({
        nowMs: NOW,
        state: 'connecting',
        activePath: 'lan',
        lastConnectedAt: null,
        entries: []
      })
    ).toEqual({ tone: 'warning', text: 'Not connected · connecting' })
  })

  // Review, 2026-09-27: a drop from yesterday's app session was shown as today's "since 09:12:00".
  it('does not date "Not connected since" from a drop in an earlier app session', () => {
    const yesterday = new Date(2026, 8, 26, 9, 0, 0).getTime()
    const entries: ConnectionLogEntry[] = [
      {
        id: 'a',
        ts: yesterday,
        level: 'success',
        message: 'Relay: runtime channel migrated to relay',
        code: 'relay-connected',
        path: 'relay'
      },
      {
        id: 'b',
        ts: yesterday + 12 * 60_000,
        level: 'error',
        message: 'Relay: active relay session failed',
        code: 'relay-session-failed',
        path: 'relay'
      },
      {
        id: 'c',
        ts: localTime(14, 0, 0),
        level: 'info',
        message: 'Mobile client session started',
        code: 'client-session-started'
      },
      reconnecting('d', localTime(14, 0, 1), 1)
    ]

    expect(
      liveConnectionRow({
        nowMs: NOW,
        state: 'connecting',
        activePath: 'lan',
        lastConnectedAt: null,
        entries
      })
    ).toEqual({ tone: 'warning', text: 'Not connected · connecting' })
  })

  it('dates a time that is not today', () => {
    const yesterday = new Date(2026, 8, 26, 23, 58, 4).getTime()
    expect(
      liveConnectionRow({
        nowMs: NOW,
        state: 'connected',
        activePath: 'relay',
        lastConnectedAt: yesterday,
        entries: []
      }).text
    ).toBe('Connected via Relay since 2026-09-26 23:58:04')
  })
})

describe('the diagnostics timeline', () => {
  it('folds the LAN retry loop under a live relay into one row', () => {
    const rows = buildConnectionTimeline(reportedLogTail())

    expect(summarize(rows)).toEqual([
      '14:20:06 Android paused the app',
      '14:20:06 Relay: relay credential expired or rejected; slow reprobe armed',
      '14:20:06 Relay: adopted fresher durable credential bundle',
      '14:20:09 Relay: runtime channel migrated to relay',
      '14:20:09 Relay: runtime channel migrated to relay',
      '14:20:16 Direct Wi-Fi path: 7 failed attempts, 14:20:16–14:21:47, next retry in 30 s (27 lines)',
      '14:22:16 App returned to foreground',
      '14:22:17 Reconnecting (attempt 8)'
    ])
  })

  it('keeps every folded line, in order, for the expanded view', () => {
    const tail = reportedLogTail()
    const folded = buildConnectionTimeline(tail).find((row) => row.kind === 'direct-failures')

    expect(folded?.entries.map((entry) => entry.id)).toEqual(
      tail
        .filter((entry) => entry.ts >= localTime(14, 20, 16) && entry.ts < localTime(14, 22, 16))
        .map((entry) => entry.id)
    )
  })

  it('leaves a single direct failure as it is', () => {
    const tail = reportedLogTail()
    const oneClose = tail.filter((entry) => entry.ts < localTime(14, 20, 17))

    expect(summarize(buildConnectionTimeline(oneClose)).slice(-3)).toEqual([
      '14:20:16 WebSocket closed',
      '14:20:16 Relay: recovery deferred by cooldown or gate',
      '14:20:16 Reconnect scheduled in 500ms'
    ])
  })

  it('names Tailscale for a tailnet endpoint and says when the probe gave up', () => {
    const entries: ConnectionLogEntry[] = [1, 2].map((attempt) => ({
      id: `ts-${attempt}`,
      ts: localTime(8, 0, attempt * 10),
      level: 'warn',
      message: 'WebSocket closed',
      detail:
        attempt === 2
          ? 'Close code unavailable; probe gave up'
          : 'Close code 1006; reconnect scheduled',
      code: 'socket-closed',
      path: 'tailscale'
    }))

    expect(summarize(buildConnectionTimeline(entries))).toEqual([
      '08:00:10 Direct Tailscale path: 2 failed attempts, 08:00:10–08:00:20, stopped retrying (2 lines)'
    ])
  })

  it('keeps two interleaved clients in time order, labelled, and folds neither across the other', () => {
    const tail = reportedLogTail()
    // Two clients' loops interleaved, as in the report's 00:27 burst (three reconnect loops, each
    // event three times with different attempt counters).
    const twoClients: EntryWithClient[] = tail.flatMap((entry) =>
      entry.path === 'lan'
        ? [
            { ...entry, clientGeneration: 2 },
            { ...entry, id: `${entry.id}-c3`, clientGeneration: 3 }
          ]
        : [entry]
    )

    const rows = buildConnectionTimeline(twoClients)
    const times = rows.map((row) => (row.kind === 'entry' ? row.entry.ts : row.ts))

    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(rows.filter((row) => row.kind === 'direct-failures')).toEqual([])
    expect(summarize(rows).slice(5, 9)).toEqual([
      '14:20:16 WebSocket closed [client 2]',
      '14:20:16 WebSocket closed [client 3]',
      '14:20:16 Relay: recovery deferred by cooldown or gate',
      '14:20:16 Reconnect scheduled in 500ms [client 2]'
    ])
  })

  it('folds one client after another, each labelled, in the order they ran', () => {
    const tail = reportedLogTail()
    const relayUp = tail.filter((entry) => entry.code === 'relay-connected')
    const loop = tail.filter(
      (entry) => entry.ts >= localTime(14, 20, 16) && entry.ts < localTime(14, 22, 16)
    )
    const later = 60 * 60_000
    const clients: EntryWithClient[] = [
      ...relayUp,
      ...loop.map((entry) => ({ ...entry, clientGeneration: 2 })),
      ...loop.map((entry) => ({
        ...entry,
        id: `${entry.id}-c3`,
        ts: entry.ts + later,
        clientGeneration: 3
      }))
    ]

    expect(summarize(buildConnectionTimeline(clients))).toEqual([
      '14:20:09 Relay: runtime channel migrated to relay',
      '14:20:09 Relay: runtime channel migrated to relay',
      '14:20:16 Direct Wi-Fi path: 7 failed attempts, 14:20:16–14:21:47, next retry in 30 s [client 2] (27 lines)',
      '15:20:16 Direct Wi-Fi path: 7 failed attempts, 15:20:16–15:21:47, next retry in 30 s [client 3] (27 lines)'
    ])
  })

  it('reads no client label from an entry that does not carry a whole-number one', () => {
    const odd = [
      { ...reportedLogTail()[0]!, clientGeneration: 'x' }
    ] as unknown as ConnectionLogEntry[]

    expect(buildConnectionTimeline(odd)[0]).toMatchObject({ kind: 'entry', client: null })
  })

  it('gives each copy of a repeated entry its own row key', () => {
    const [first] = reportedLogTail()
    const keys = buildConnectionTimeline([first!, first!]).map((row) => row.key)

    expect(new Set(keys).size).toBe(2)
  })

  // Review, 2026-09-27: the health-check failure and the close that ended a WORKING direct
  // session were folded into "failed attempts" and counted as one.
  it('keeps the drop of a live Wi-Fi session in view and counts only the retries after it', () => {
    const at = (seconds: number) => localTime(9, 0, 0) + seconds * 1000
    const entries: ConnectionLogEntry[] = [
      {
        id: 'auth',
        ts: at(0),
        level: 'success',
        message: 'Authenticated',
        detail: 'Channel ready for RPC',
        code: 'direct-connected',
        path: 'lan'
      },
      {
        id: 'health',
        ts: at(60),
        level: 'error',
        message: 'Connection health check failed',
        detail: 'no reply; 3/3 probes missed; last authenticated activity 45000ms ago',
        code: 'liveness-timeout',
        path: 'lan'
      },
      closed('drop-close', at(60)),
      scheduled('s1', at(60), 1000, 1),
      reconnecting('r2', at(61), 2),
      closed('c2', at(71)),
      scheduled('s2', at(71), 2000, 2),
      reconnecting('r3', at(73), 3),
      closed('c3', at(83)),
      scheduled('s3', at(83), 4000, 3)
    ]

    expect(summarize(buildConnectionTimeline(entries))).toEqual([
      '09:00:00 Authenticated',
      '09:01:00 Connection health check failed',
      '09:01:00 WebSocket closed',
      '09:01:11 Direct Wi-Fi path: 2 failed attempts, 09:01:11–09:01:23, next retry in 4 s (7 lines)'
    ])
  })

  it('keeps the close that ended a live session when the desktop simply quit', () => {
    const at = (seconds: number) => localTime(9, 0, 0) + seconds * 1000
    const entries: ConnectionLogEntry[] = [
      {
        id: 'auth',
        ts: at(0),
        level: 'success',
        message: 'Authenticated',
        code: 'direct-connected',
        path: 'lan'
      },
      { ...closed('quit', at(30)), detail: 'Close code 1001; reconnect scheduled' },
      scheduled('s1', at(30), 500, 1),
      reconnecting('r2', at(31), 2),
      closed('c2', at(41)),
      scheduled('s2', at(41), 1000, 2),
      reconnecting('r3', at(42), 3),
      closed('c3', at(52)),
      scheduled('s3', at(52), 1000, 3)
    ]

    expect(summarize(buildConnectionTimeline(entries))).toEqual([
      '09:00:00 Authenticated',
      '09:00:30 WebSocket closed',
      '09:00:41 Direct Wi-Fi path: 2 failed attempts, 09:00:41–09:00:52, retrying every 1 s (7 lines)'
    ])
  })

  it('does not fold the relay deferral lines while the relay itself is down', () => {
    const relayDown: ConnectionLogEntry = {
      id: 'relay-down',
      ts: localTime(14, 20, 12),
      level: 'error',
      message: 'Relay: active relay session failed',
      detail: 'Error: relay_outer_1006 (Software caused connection abort)',
      code: 'relay-session-failed',
      path: 'relay'
    }
    const tail = reportedLogTail()
    const entries = [
      ...tail.filter((entry) => entry.ts < relayDown.ts),
      relayDown,
      ...tail.filter((entry) => entry.ts > relayDown.ts)
    ]

    const rows = buildConnectionTimeline(entries)

    expect(rows.filter((row) => row.kind === 'direct-failures')).toEqual([])
    expect(
      summarize(rows).filter((row) => row.endsWith('Relay: recovery deferred by cooldown or gate'))
    ).toHaveLength(7)
  })

  it('is empty for an empty log', () => {
    expect(buildConnectionTimeline([])).toEqual([])
  })

  it('keeps a one-entry log as one row', () => {
    const [first] = reportedLogTail()
    expect(summarize(buildConnectionTimeline([first!]))).toEqual([
      '14:20:06 Android paused the app'
    ])
  })
})
