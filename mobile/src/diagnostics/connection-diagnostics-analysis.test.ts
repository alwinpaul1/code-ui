import { describe, expect, it } from 'vitest'
import {
  diagnoseConnection,
  getReportableConnectionIncidentId
} from './connection-diagnostics-analysis'
import type { ConnectionLogEntry } from '../transport/types'

function event(message: string, detail?: string): ConnectionLogEntry {
  return { id: message, ts: 1, level: 'error', message, detail }
}

describe('diagnoseConnection', () => {
  it('reports the current healthy path instead of a historical failure', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://100.88.90.25:6768',
        state: 'connected',
        activePath: 'relay',
        entries: [event('WebSocket connect timeout')]
      })
    ).toEqual({
      likelyCause: 'Connection is healthy via Relay.',
      nextStep: 'No action needed.',
      reportability: 'none'
    })
  })

  it('distinguishes an invalid Relay credential from a transient outage', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://100.88.90.25:6768',
        state: 'reconnecting',
        pendingPath: 'relay',
        entries: [event('Relay: relay dial failed', 'relay director resolve failed (401)')]
      })
    ).toEqual({
      likelyCause: 'Relay rejected the saved resume credential.',
      nextStep: 'Try a direct connection; if Relay keeps returning 401, pair this device again.',
      reportability: 'none'
    })
  })

  it('keeps the refused credential ahead of a 503 when both sit before the last resume', () => {
    // Review of the #21566 merge (2026-09-19): the selector may pick a failure from before the
    // app last resumed, and the 401 sweep has to read the same run that failure came from — not
    // the empty window after the resume — or the stale qualifier wraps the exact "keep Orca open,
    // recovery will retry" advice the 2026-09-14 rule exists to remove.
    const diagnosis = diagnoseConnection({
      endpoint: 'ws://100.88.90.25:6768',
      state: 'reconnecting',
      pendingPath: 'relay',
      entries: [
        { ...event('Relay: relay dial failed', 'relay director resolve failed (401)'), id: 'r1' },
        { ...event('Relay: relay dial failed', 'relay director resolve failed (401)'), id: 'r2' },
        {
          ...event('Relay: relay dial failed', 'relay director resolve failed (503)'),
          id: 'r3',
          ts: 3
        },
        { ...event('App returned to foreground'), id: 'resume', ts: 4, code: 'app-resumed' }
      ]
    })
    expect(diagnosis.likelyCause).toBe(
      'Before the app last resumed: Relay rejected the saved resume credential.'
    )
    expect(diagnosis.nextStep).not.toContain('recovery should retry')
    expect(diagnosis.reportability).toBe('none')
  })

  it("reads the Relay's own close code instead of blaming the phone's reach", () => {
    // Verbatim from a report on 2026-09-12: the Relay drained, every dial for
    // 17 minutes closed with 4503, and the diagnosis said "relay_outer_1006 …
    // either this phone cannot reach the Relay" — `\\b503\\b` never matches
    // inside `relay_outer_4503`.
    const entry: ConnectionLogEntry = {
      id: 'dial',
      ts: 2,
      level: 'error',
      message: 'Relay: relay dial failed',
      detail: 'Error: relay_outer_4503',
      code: 'relay-dial-failed',
      path: 'relay'
    }
    const diagnosis = diagnoseConnection({
      endpoint: '192.168.1.154:6768',
      state: 'connecting' as const,
      activePath: 'relay' as const,
      pendingPath: 'relay' as const,
      entries: [
        event('Relay: active relay session failed', 'Error: relay_outer_4503 (relay draining)'),
        entry
      ]
    })
    expect(diagnosis.likelyCause).toContain('4503')
    expect(diagnosis.likelyCause).toContain('Relay service itself')
    expect(diagnosis.likelyCause).not.toContain('1006')
    expect(diagnosis.likelyCause).not.toContain('cannot reach')
    // The draining case no longer steers to a LAN or Tailscale endpoint:
    // behind a full-tunnel VPN with Tailscale signed out, neither is
    // reachable, so the advice sent the user hunting a path that was not
    // there. Recovery is the only true next step for 4503 (2026-09-12).
    expect(diagnosis.nextStep).toContain('recovery keeps retrying')
    expect(diagnosis.nextStep).not.toContain('LAN or Tailscale')
  })

  it('names the desktop, not the phone, when the Relay has no session for it', () => {
    const diagnosis = diagnoseConnection({
      endpoint: '192.168.1.154:6768',
      state: 'connecting' as const,
      pendingPath: 'relay' as const,
      entries: [
        {
          id: 'dial',
          ts: 3,
          level: 'error',
          message: 'Relay: relay dial failed',
          detail: 'Error: relay_outer_4404',
          code: 'relay-dial-failed',
          path: 'relay'
        }
      ]
    })
    expect(diagnosis.likelyCause).toContain('4404')
    expect(diagnosis.nextStep).toContain('desktop')
  })

  it('names an overloaded Relay cell from the socket error text', () => {
    const entry: ConnectionLogEntry = {
      id: 'dial',
      ts: 1,
      level: 'error',
      message: 'relay dial failed',
      detail: "Error: relay_outer_1006 (Expected HTTP 101 response but was '503 Service Unavailable')",
      code: 'relay-dial-failed',
      path: 'relay'
    }
    const args = {
      endpoint: 'ws://100.72.20.78:6768',
      state: 'reconnecting' as const,
      pendingPath: 'relay' as const,
      entries: [event('WebSocket closed', 'Close code 1006; reconnect scheduled'), entry]
    }
    expect(diagnoseConnection(args)).toEqual({
      likelyCause:
        'The Relay cell refused the connection with 503 (overloaded or draining). The desktop is dropped from it too, so nothing on this phone can restore the Relay path.',
      nextStep:
        'Wait for the Relay to recover, or use a LAN or Tailscale endpoint, which bypasses the Relay.',
      reportability: 'orca-relay'
    })
    expect(getReportableConnectionIncidentId(args)).toBe('dial')
  })

  it('reads a 403 in the socket error text as a refused device, whatever the close code', () => {
    // Review of the #21566 merge (2026-09-19): the socket text is the one place the cell's HTTP
    // status leaks through, and a real dial entry always carries a close code (1006 here), so the
    // text has to be read before the code is mapped — the sibling 503 check already was.
    expect(
      diagnoseConnection({
        endpoint: 'ws://100.72.20.78:6768',
        state: 'reconnecting',
        pendingPath: 'relay',
        entries: [
          {
            ...event(
              'relay dial failed',
              "Error: relay_outer_1006 (Expected HTTP 101 response but was '403 Forbidden')"
            ),
            code: 'relay-dial-failed',
            path: 'relay',
            relayCloseCode: 1006
          }
        ]
      })
    ).toEqual({
      likelyCause: 'The Relay cell rejected this device before the handshake.',
      nextStep: 'Re-pair this phone with the desktop.',
      reportability: 'none'
    })
  })

  it('explains a bare relay_outer_1006 instead of "no specific failure"', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://100.72.20.78:6768',
        state: 'connecting',
        pendingPath: 'relay',
        entries: [event('Relay: relay dial failed', 'Error: relay_outer_1006')]
      })
    ).toMatchObject({
      likelyCause: expect.stringContaining('relay_outer_1006'),
      nextStep: expect.stringContaining('Relay connected'),
      reportability: 'none'
    })
  })

  it('identifies the direct Tailscale timeout while Relay recovery is pending', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://100.88.90.25:6768',
        state: 'reconnecting',
        activePath: 'tailscale',
        pendingPath: 'relay',
        entries: [event('WebSocket connect timeout')]
      })
    ).toEqual({
      likelyCause: 'The saved Tailscale endpoint did not answer before the connection timeout.',
      nextStep: 'Relay recovery is in progress; keep Orca open while it retries.',
      reportability: 'none'
    })
  })

  it('identifies an authenticated Relay liveness failure', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://192.168.1.2:6768',
        state: 'reconnecting',
        activePath: 'relay',
        entries: [
          {
            ...event('Relay health check failed'),
            code: 'liveness-timeout',
            path: 'relay'
          }
        ]
      })
    ).toEqual({
      likelyCause: 'Relay stopped answering authenticated health checks.',
      nextStep: 'Orca closed the stale session and started recovery.',
      reportability: 'orca-relay'
    })
  })

  it('separates an active Relay close from a failed Relay dial', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://192.168.1.2:6768',
        state: 'reconnecting',
        activePath: 'relay',
        entries: [
          {
            ...event('Relay: active relay session failed', 'RelayOuterError: close code 4408'),
            code: 'relay-session-failed',
            path: 'relay'
          }
        ]
      })
    ).toEqual({
      likelyCause: 'The active Relay session closed unexpectedly.',
      nextStep: 'Orca started Relay recovery; the event history includes the cell close reason.',
      reportability: 'orca-relay'
    })
  })

  it('marks authenticated Relay liveness failures as safe to send', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://192.168.1.2:6768',
        state: 'reconnecting',
        activePath: 'relay',
        entries: [
          {
            ...event('Relay health check failed'),
            code: 'liveness-timeout',
            path: 'relay'
          }
        ]
      }).reportability
    ).toBe('orca-relay')
  })

  it.each([
    ['direct timeout', 'connect-timeout', 'tailscale'],
    ['handshake timeout', 'handshake-timeout', 'relay'],
    ['invalid credential', 'relay director resolve failed (401)', 'relay'],
    ['ambiguous recovery', 'retry scheduled', 'relay']
  ] as const)('does not offer submission for %s', (_name, message, path) => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://100.88.90.25:6768',
        state: 'reconnecting',
        pendingPath: 'relay',
        entries: [{ ...event(message), path }]
      }).reportability
    ).toBe('none')
  })

  it('does not offer submission for a bounded Relay director outage', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://100.88.90.25:6768',
        state: 'reconnecting',
        pendingPath: 'relay',
        entries: [event('Relay: relay dial failed', 'relay director resolve failed (503)')]
      }).reportability
    ).toBe('none')
  })

  it('classifies the newest failure instead of an older persisted 401', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://100.88.90.25:6768',
        state: 'reconnecting',
        pendingPath: 'relay',
        entries: [
          event('Relay: relay dial failed', 'relay director resolve failed (401)'),
          { ...event('WebSocket connect timeout'), id: 'newer', ts: 2, code: 'connect-timeout' }
        ]
      }).likelyCause
    ).toBe('The saved Tailscale endpoint did not answer before the connection timeout.')
  })

  it('requires structured Relay evidence before offering submission', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://192.168.1.2:6768',
        state: 'reconnecting',
        activePath: 'relay',
        entries: [event('active relay session failed')]
      }).reportability
    ).toBe('none')
  })

  it('ignores failures from before the current app resume boundary', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://192.168.1.2:6768',
        state: 'connecting',
        activePath: 'lan',
        entries: [
          {
            ...event('Relay health check failed'),
            code: 'liveness-timeout',
            path: 'relay'
          },
          {
            ...event('App returned to foreground'),
            id: 'resume',
            ts: 2,
            code: 'app-resumed'
          },
          { ...event('WebSocket closed'), id: 'closed', ts: 3, code: 'socket-closed' }
        ]
      }).reportability
    ).toBe('none')
  })

  it('uses a structured direct liveness path ahead of the current active path', () => {
    expect(
      diagnoseConnection({
        endpoint: 'ws://192.168.1.2:6768',
        state: 'reconnecting',
        activePath: 'relay',
        entries: [
          {
            ...event('Connection health check failed'),
            code: 'liveness-timeout',
            path: 'lan'
          }
        ]
      })
    ).toEqual({
      likelyCause: 'The connected host stopped answering authenticated health checks.',
      nextStep: 'Orca closed the stale session and started recovery.',
      reportability: 'none'
    })
  })

  it('keys reportability to the current structured incident', () => {
    const args = {
      endpoint: 'ws://192.168.1.2:6768',
      state: 'reconnecting' as const,
      activePath: 'relay' as const,
      entries: [
        { ...event('Authenticated'), code: 'direct-connected' as const, path: 'lan' as const },
        {
          ...event('Relay health check failed'),
          id: 'current-relay-failure',
          ts: 2,
          code: 'liveness-timeout' as const,
          path: 'relay' as const
        }
      ]
    }

    expect(getReportableConnectionIncidentId(args)).toBe('current-relay-failure')
    expect(
      getReportableConnectionIncidentId({
        ...args,
        entries: [...args.entries, { ...event('Network changed'), ts: 3, code: 'network-changed' }]
      })
    ).toBeNull()
  })
})

describe('a rejected credential behind a passing blip', () => {
  // Reported 2026-09-14 from another person's phone: four "relay director
  // resolve failed (401)" in a row, then one 503, and the screen said the relay
  // was "temporarily unavailable" and to keep Orca open because recovery would
  // retry. It never could: 401 is a rejected resume credential and no amount of
  // retrying fixes it. The analysis read only the LAST failure.
  const entry = (message: string, detail: string) => ({
    at: 0,
    level: 'error' as const,
    code: 'relay-dial-failed',
    message,
    detail,
    path: 'relay' as const
  })
  const realLog = [
    entry('Relay: relay dial failed', 'RelayDirectorHttpError: relay director resolve failed (401)'),
    entry('Relay: relay dial failed', 'RelayDirectorHttpError: relay director resolve failed (401)'),
    entry('Relay: relay dial failed', 'RelayDirectorHttpError: relay director resolve failed (401)'),
    entry(
      'Relay: relay dial failed',
      'RelayDirectorHttpError: relay director resolve failed (503); retry-after=5000ms'
    )
  ]

  it('names the rejected credential, not the one 503 that landed last', () => {
    const diagnosis = diagnoseConnection({
      endpoint: '192.168.0.15:6768',
      state: 'connecting',
      entries: realLog
    })
    expect(diagnosis.likelyCause).toMatch(/rejected the saved resume credential/i)
    expect(diagnosis.nextStep).toMatch(/pair this device again/i)
    expect(diagnosis.likelyCause).not.toMatch(/temporarily unavailable/i)
  })

  it('still calls a lone 503 temporary, since that one does recover on its own', () => {
    const diagnosis = diagnoseConnection({
      endpoint: '192.168.0.15:6768',
      state: 'connecting',
      entries: [realLog[3]!]
    })
    expect(diagnosis.likelyCause).toMatch(/temporarily unavailable/i)
  })
})

// 2026-09-21, a friend's phone (Telegram): connected to the desktop on its
// Wi-Fi for 33 hours, then switched to mobile data. Every reconnect dialled
// the desktop's 192.168.1.132:6768 and closed with 1006, and the page said "No
// single failure cause can be determined". The cause was plain: a private
// network address cannot be reached from outside that network, and the phone
// had no Relay for this desktop, so nothing else was tried.
describe('a desktop known only by a private network address, after the phone left that network', () => {
  const kavin: ConnectionLogEntry[] = [
    { id: '1', ts: 121091, level: 'info', message: 'Authenticated', detail: 'Channel ready for RPC' },
    { id: '2', ts: 121105, level: 'warn', message: 'WebSocket closed', detail: 'Close code 1006; reconnect scheduled' },
    { id: '3', ts: 121105, level: 'info', message: 'Reconnect scheduled in 500ms', detail: 'Attempt 1' },
    { id: '4', ts: 121105, level: 'info', code: 'network-changed', message: 'Network changed', detail: 'Connection recovery notified' },
    { id: '5', ts: 121105, level: 'info', message: 'Opening WebSocket', detail: '192.168.1.132:6768' },
    { id: '6', ts: 121109, level: 'warn', message: 'WebSocket closed', detail: 'Close code unavailable; reconnect scheduled' },
    { id: '7', ts: 121109, level: 'info', message: 'Reconnecting (attempt 2)', detail: '192.168.1.132:6768' },
    { id: '8', ts: 121119, level: 'warn', message: 'WebSocket closed', detail: 'Close code 1006; reconnect scheduled' },
    { id: '9', ts: 121120, level: 'info', message: 'Reconnecting (attempt 3)', detail: '192.168.1.132:6768' },
    { id: '10', ts: 121130, level: 'warn', message: 'WebSocket closed', detail: 'Close code 1006; reconnect scheduled' }
  ]

  it('names the private address and the missing Relay instead of "no single cause"', () => {
    const diagnosis = diagnoseConnection({
      endpoint: 'ws://192.168.1.132:6768',
      state: 'connecting',
      activePath: 'lan',
      pendingPath: null,
      entries: kavin
    })
    expect(diagnosis.likelyCause).toBe(
      'The desktop is saved by a private network address (192.168.1.132), which only answers from the same Wi‑Fi or LAN, and the phone’s network changed.'
    )
    expect(diagnosis.nextStep).toBe(
      'Rejoin that network, or enable Orca Relay on the desktop (Settings → Relay, sign in) so this phone can reach it from anywhere.'
    )
    expect(diagnosis.reportability).toBe('none')
  })

  it('says mobile data when the phone reports it is on cellular', () => {
    const diagnosis = diagnoseConnection({
      endpoint: 'ws://192.168.1.132:6768',
      state: 'connecting',
      activePath: 'lan',
      pendingPath: null,
      entries: kavin,
      networkType: 'CELLULAR'
    })
    expect(diagnosis.likelyCause).toBe(
      'The desktop is saved by a private network address (192.168.1.132), which only answers from the same Wi‑Fi or LAN, and the phone is on mobile data.'
    )
  })

  it('leaves a public or Tailscale address, and a host with Relay recovery pending, to the rules above', () => {
    expect(
      diagnoseConnection({ endpoint: 'ws://100.101.102.103:6768', state: 'connecting', pendingPath: null, entries: kavin })
        .likelyCause
    ).not.toMatch(/private network address/)
    expect(
      diagnoseConnection({ endpoint: 'ws://192.168.1.132:6768', state: 'connecting', pendingPath: 'relay', entries: kavin })
        .likelyCause
    ).not.toMatch(/private network address/)
  })

  it('does not fire on a private address that has not seen a network change, which is an ordinary LAN outage', () => {
    const noChange = kavin.filter((entry) => entry.message !== 'Network changed')
    expect(
      diagnoseConnection({ endpoint: 'ws://192.168.1.132:6768', state: 'connecting', pendingPath: null, entries: noChange })
        .likelyCause
    ).not.toMatch(/private network address/)
  })
})
