import { describe, expect, it } from 'vitest'
import { diagnoseConnection } from './connection-diagnostics-analysis'
import type { ConnectionLogEntry } from '../transport/types'

// A relay outage that asked for a retry in 59.5 to 59.999 seconds read "asked
// Orca to retry in 60s": the delay chose seconds before rounding, and the
// seconds rounded up into a minute (review, 2026-09-30). It now rounds first
// and names the unit of what it rounded to.
//
// The detail line is the one mobile-relay-diagnostic-log.ts writes for a
// director error with a Retry-After (`…; retry-after=<ms>ms`), which the
// phone caps at MOBILE_RELAY_RETRY_AFTER_MAX_MS (120 s).

function directorOutage(retryAfterMs: number): ConnectionLogEntry[] {
  return [
    {
      id: 'e1',
      ts: Date.parse('2026-09-30T10:00:00Z'),
      level: 'error',
      path: 'relay',
      message: 'Relay: relay dial failed',
      detail: `RelayDirectorHttpError: relay director resolve failed (503); retry-after=${retryAfterMs}ms`
    }
  ]
}

function cause(retryAfterMs: number): string {
  return diagnoseConnection({
    endpoint: 'ws://192.168.1.2:55927',
    state: 'connecting',
    activePath: 'lan',
    pendingPath: null,
    entries: directorOutage(retryAfterMs)
  }).likelyCause
}

const said = (delay: string): string =>
  `Relay service was temporarily unavailable and asked Orca to retry in ${delay}.`

describe('the retry delay a relay outage names, at the edge of a minute', () => {
  it.each([
    [59_499, '59s'],
    [59_500, '1m'],
    [59_999, '1m'],
    [60_000, '1m'],
    [120_000, '2m']
  ])('says a %i ms delay is %s', (ms, delay) => {
    expect(cause(ms)).toBe(said(delay))
  })

  it('keeps the ordinary and the degenerate delays as they were', () => {
    expect(cause(30_000)).toBe(said('30s'))
    expect(cause(1_000)).toBe(said('1s'))
    expect(cause(0)).toBe(said('0s'))
  })
})
