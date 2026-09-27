import type { ConnectionLogEntry } from '../transport/types'

/**
 * The tail of the connection log from the 2026-09-27 report (a friend's Pixel, Orca Mobile
 * 0.9.54, host Orca 1.4.215 on a Windows Mobile Hotspot, 192.168.137.1). Messages and details
 * are the strings the screen showed, word for word: "WebSocket closed / Close code 1006;
 * reconnect scheduled", "Relay: recovery deferred by cooldown or gate", "Reconnect scheduled in
 * 8000ms / Attempt 5", "Reconnecting (attempt 6) / 192.168.137.1:6768", "App returned to
 * foreground / Connection recovery notified". Times are the export's (14:20:06 to 14:22:17),
 * built in LOCAL time so the clock the screen prints reads the same in any time zone.
 *
 * After the relay connected at 14:20:09 every LAN attempt hung about 10 s and closed 1006, and
 * every close was followed by a relay deferral line. So the tail the screen showed under
 * "connected · healthy via Relay" was nothing but failures.
 */
export function localTime(hours: number, minutes: number, seconds: number, ms = 0): number {
  return new Date(2026, 8, 27, hours, minutes, seconds, ms).getTime()
}

export const REPORTED_ENDPOINT = 'ws://192.168.137.1:6768'
export const REPORTED_LAST_CONNECTED_AT = localTime(14, 20, 9, 549)

const LAN = '192.168.137.1:6768'

/** The seven LAN closes after the relay came up, and the retry each one scheduled. */
const LAN_CLOSES: readonly { at: number; retryMs: number }[] = [
  { at: localTime(14, 20, 16, 573), retryMs: 500 },
  { at: localTime(14, 20, 27, 90), retryMs: 1000 },
  { at: localTime(14, 20, 38, 120), retryMs: 2000 },
  { at: localTime(14, 20, 50, 150), retryMs: 4000 },
  { at: localTime(14, 21, 4, 180), retryMs: 8000 },
  { at: localTime(14, 21, 22, 210), retryMs: 15000 },
  { at: localTime(14, 21, 47, 240), retryMs: 30000 }
]

function lanLoop(): ConnectionLogEntry[] {
  return LAN_CLOSES.flatMap(({ at, retryMs }, index): ConnectionLogEntry[] => {
    const attempt = index + 1
    const next: ConnectionLogEntry[] =
      index < LAN_CLOSES.length - 1
        ? [
            {
              id: `log-reconnecting-${attempt + 1}`,
              ts: at + retryMs,
              level: 'info',
              message: `Reconnecting (attempt ${attempt + 1})`,
              detail: LAN,
              path: 'lan'
            }
          ]
        : []
    return [
      {
        id: `log-closed-${attempt}`,
        ts: at,
        level: 'warn',
        message: 'WebSocket closed',
        detail: 'Close code 1006; reconnect scheduled',
        code: 'socket-closed',
        path: 'lan'
      },
      {
        id: `relay-deferred-${attempt}`,
        ts: at + 1,
        level: 'info',
        message: 'Relay: recovery deferred by cooldown or gate',
        path: 'relay'
      },
      {
        id: `log-scheduled-${attempt}`,
        ts: at + 2,
        level: 'info',
        message: `Reconnect scheduled in ${retryMs}ms`,
        detail: `Attempt ${attempt}`,
        code: 'retry-scheduled',
        path: 'lan'
      },
      ...next
    ]
  })
}

export function reportedLogTail(): ConnectionLogEntry[] {
  return [
    {
      id: `app-paused-${localTime(14, 20, 6, 579)}`,
      ts: localTime(14, 20, 6, 579),
      level: 'warn',
      code: 'app-paused',
      message: 'Android paused the app',
      detail: `Nothing ran for 27m (since ${new Date(localTime(13, 52, 50)).toISOString()}): no reconnects, no notifications. On waking: background service not running, battery unrestricted`
    },
    {
      id: 'relay-a-1',
      ts: localTime(14, 20, 6, 664),
      level: 'warn',
      message: 'Relay: relay credential expired or rejected; slow reprobe armed',
      code: 'relay-credential-unavailable',
      path: 'relay'
    },
    {
      id: 'relay-a-2',
      ts: localTime(14, 20, 6, 832),
      level: 'info',
      message: 'Relay: adopted fresher durable credential bundle',
      path: 'relay'
    },
    {
      id: 'relay-a-3',
      ts: localTime(14, 20, 9, 527),
      level: 'success',
      message: 'Relay: runtime channel migrated to relay',
      detail: 'dialed in 2.6s',
      code: 'relay-connected',
      path: 'relay'
    },
    {
      id: 'relay-b-1',
      ts: localTime(14, 20, 9, 564),
      level: 'success',
      message: 'Relay: runtime channel migrated to relay',
      detail: 'dialed in 2.6s',
      code: 'relay-connected',
      path: 'relay'
    },
    ...lanLoop(),
    {
      id: 'app-resumed-1',
      ts: localTime(14, 22, 16, 399),
      level: 'info',
      message: 'App returned to foreground',
      detail: 'Connection recovery notified',
      code: 'app-resumed'
    },
    {
      id: 'log-reconnecting-8',
      ts: localTime(14, 22, 17, 240),
      level: 'info',
      message: 'Reconnecting (attempt 8)',
      detail: LAN,
      path: 'lan'
    }
  ]
}
