/**
 * Whether a document that failed to load should be read again.
 *
 * Opening a tab before the relay has connected leaves the read failing, and the
 * tab then said "Couldn't load markdown" for as long as it was open: the effect
 * that fetches a document only ran when there was NO document at all, and an
 * error is a document. So the connection came up seconds later and nothing
 * noticed (reported 2026-09-15 — "instead of auto refresh as the relay
 * connected it stayed stale").
 *
 * The signal is `lastConnectedAt`, which moves each time the host connects. The
 * rule is one retry per NEW connection, never one per render: the first sighting
 * of an error only records which connection it happened on, and a retry follows
 * only once that value has changed. Without that record the effect would see its
 * own failure, retry, fail, and spin for as long as the host stayed down.
 */
export type StaleAfterReconnectLedger = Map<string, number | null>

export function createStaleAfterReconnectLedger(): StaleAfterReconnectLedger {
  return new Map()
}

export function shouldRefetchAfterReconnect(
  ledger: StaleAfterReconnectLedger,
  tabId: string,
  status: 'loading' | 'ready' | 'error' | 'missing',
  lastConnectedAt: number | null
): boolean {
  if (status === 'missing') {
    // Never fetched. The caller's own first-read path owns this.
    ledger.delete(tabId)
    return true
  }
  if (status !== 'error') {
    // Recovered, or still in flight. Forget the failure so the NEXT one is
    // judged against the connection it actually happened on.
    ledger.delete(tabId)
    return false
  }
  if (!ledger.has(tabId)) {
    ledger.set(tabId, lastConnectedAt)
    return false
  }
  if (ledger.get(tabId) === lastConnectedAt) {
    return false
  }
  ledger.set(tabId, lastConnectedAt)
  return true
}
