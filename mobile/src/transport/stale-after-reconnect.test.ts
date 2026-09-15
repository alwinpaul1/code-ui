import { describe, expect, it } from 'vitest'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from './stale-after-reconnect'

// Reported 2026-09-15 with a screenshot: the project and CLAUDE.md were opened
// before the relay had connected, the read failed, and the tab then showed
// "Couldn't load markdown" for as long as it stayed open. The connection came up
// moments later and nothing re-read it.
describe('a document opened before the relay connected', () => {
  it('reads again once the host connects', () => {
    const ledger = createStaleAfterReconnectLedger()
    // Opened with no connection: the read fails, and the first sighting only
    // records which connection it failed on.
    expect(shouldRefetchAfterReconnect(ledger, 'tab', 'error', null)).toBe(false)
    // The relay connects.
    expect(shouldRefetchAfterReconnect(ledger, 'tab', 'error', 1_000)).toBe(true)
  })

  it('does not spin while the host stays down', () => {
    const ledger = createStaleAfterReconnectLedger()
    shouldRefetchAfterReconnect(ledger, 'tab', 'error', null)
    // The effect re-runs on every render; none of these may fire a read, or a
    // failing host would be hammered for as long as the tab is open.
    for (let index = 0; index < 50; index += 1) {
      expect(shouldRefetchAfterReconnect(ledger, 'tab', 'error', null)).toBe(false)
    }
  })

  it('retries once per connection, not once per render', () => {
    const ledger = createStaleAfterReconnectLedger()
    shouldRefetchAfterReconnect(ledger, 'tab', 'error', null)
    expect(shouldRefetchAfterReconnect(ledger, 'tab', 'error', 1_000)).toBe(true)
    expect(shouldRefetchAfterReconnect(ledger, 'tab', 'error', 1_000)).toBe(false)
    // A drop and a fresh connection earns one more.
    expect(shouldRefetchAfterReconnect(ledger, 'tab', 'error', 2_000)).toBe(true)
    expect(shouldRefetchAfterReconnect(ledger, 'tab', 'error', 2_000)).toBe(false)
  })

  it('fetches a tab it has never read', () => {
    const ledger = createStaleAfterReconnectLedger()
    expect(shouldRefetchAfterReconnect(ledger, 'tab', 'missing', 1_000)).toBe(true)
  })

  it('leaves a document that loaded alone', () => {
    const ledger = createStaleAfterReconnectLedger()
    expect(shouldRefetchAfterReconnect(ledger, 'tab', 'ready', 1_000)).toBe(false)
    expect(shouldRefetchAfterReconnect(ledger, 'tab', 'loading', 2_000)).toBe(false)
  })

  it('judges a second failure against the connection it happened on', () => {
    const ledger = createStaleAfterReconnectLedger()
    shouldRefetchAfterReconnect(ledger, 'tab', 'error', 1_000)
    shouldRefetchAfterReconnect(ledger, 'tab', 'ready', 1_000)
    // Fails again on the SAME connection. It must not retry immediately just
    // because the ledger once held an older value for this tab.
    expect(shouldRefetchAfterReconnect(ledger, 'tab', 'error', 1_000)).toBe(false)
    expect(shouldRefetchAfterReconnect(ledger, 'tab', 'error', 3_000)).toBe(true)
  })

  it('keeps two tabs apart', () => {
    const ledger = createStaleAfterReconnectLedger()
    shouldRefetchAfterReconnect(ledger, 'a', 'error', null)
    shouldRefetchAfterReconnect(ledger, 'b', 'error', null)
    expect(shouldRefetchAfterReconnect(ledger, 'a', 'error', 5)).toBe(true)
    expect(shouldRefetchAfterReconnect(ledger, 'b', 'error', 5)).toBe(true)
    expect(shouldRefetchAfterReconnect(ledger, 'a', 'error', 5)).toBe(false)
  })
})
