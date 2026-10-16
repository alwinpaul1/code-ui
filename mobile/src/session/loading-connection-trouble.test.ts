import { describe, expect, it } from 'vitest'
import { classifyConnection } from '../transport/connection-health'
import { loadingConnectionTrouble, unreachableDetail } from './loading-connection-trouble'

// 2026-10-16, from the user: Clawd and "Loading session…" stayed up for as long as the desktop did
// not answer. What the loading screen says instead is the connection's own verdict, the one the
// session header already shows with "tap to retry", plus where to look (CLAUDE.md rule 9).

const NOW = 1_000_000

describe('what a loading screen says about a connection in trouble', () => {
  it('keeps loading while the phone is still dialling normally, or connected', () => {
    for (const state of ['connecting', 'reconnecting', 'handshaking', 'connected'] as const) {
      const verdict = classifyConnection({ state, reconnectAttempts: 2, lastConnectedAt: null, nowMs: NOW })
      expect(loadingConnectionTrouble(verdict, 'Studio')).toBeNull()
    }
  })

  it('says the desktop cannot be reached, names it, and says where to look', () => {
    const verdict = classifyConnection({ state: 'reconnecting', reconnectAttempts: 12, lastConnectedAt: null, nowMs: NOW })
    expect(loadingConnectionTrouble(verdict, 'Studio')).toEqual({
      label: "Can't reach desktop",
      detail: 'Studio isn’t reachable right now. Check it’s awake and Orca is running; this screen reconnects on its own.',
      retryable: true
    })
  })

  it("names no desktop it does not know, and treats a blank name as none", () => {
    const verdict = classifyConnection({ state: 'connecting', reconnectAttempts: 3, lastConnectedAt: NOW - 1000, nowMs: NOW })
    expect(loadingConnectionTrouble(verdict, null)?.label).toBe("Can't connect")
    expect(unreachableDetail(null)).toMatch(/^Your desktop isn’t reachable right now\./)
    expect(unreachableDetail('   ')).toMatch(/^Your desktop isn’t reachable/)
  })

  it("keeps the relay's own word on where to look", () => {
    const verdict = classifyConnection({
      state: 'reconnecting',
      reconnectAttempts: 1,
      lastConnectedAt: null,
      relayHostReachability: 'host-offline',
      hostName: 'Studio',
      nowMs: NOW
    })
    expect(loadingConnectionTrouble(verdict, 'Studio')).toEqual({
      label: 'Studio is offline',
      detail: "Check it's awake, Orca is running, and you're signed in",
      retryable: true
    })
  })

  it('carries the Tailscale hint in the label, as every other screen does', () => {
    const verdict = classifyConnection({
      state: 'reconnecting',
      reconnectAttempts: 12,
      lastConnectedAt: null,
      endpoint: 'ws://100.101.102.103:6768',
      nowMs: NOW
    })
    expect(loadingConnectionTrouble(verdict, null)?.label).toBe("Can't reach desktop — check Tailscale")
  })

  it('offers no retry for a refused pairing, which only re-pairing fixes', () => {
    const verdict = classifyConnection({ state: 'auth-failed', reconnectAttempts: 0, lastConnectedAt: null, nowMs: NOW })
    expect(loadingConnectionTrouble(verdict, 'Studio')).toEqual({
      label: 'Pairing invalid — re-pair with your desktop',
      detail: null,
      retryable: false
    })
  })
})
