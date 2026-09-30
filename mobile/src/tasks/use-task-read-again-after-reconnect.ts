import { useEffect, useRef } from 'react'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'

/**
 * Reads a task sheet's failed load again once the host reconnects (CLAUDE.md "Nothing stays stale
 * once the relay connects").
 *
 * The detail sheets and their pickers read on open and on the refresh icon, keyed on the client,
 * which is the same object across reconnects. So a read that failed while the relay was dialling,
 * or because the link dropped under it, stayed on its error over a healthy connection until the
 * user tapped refresh (review, 2026-09-30).
 *
 * `key` names what was read (an item, a board row, one picker of one item), and `null` means
 * nothing is open. `failed` is whether the last read of it failed. `readAgain` is called at most
 * once per change of `lastConnectedAt` while `failed` holds: the first sighting of a failure only
 * records the connection it happened on (stale-after-reconnect.ts), so a host that stays down costs
 * no read, and a render is never a reason to read. A read that succeeds is never read again here.
 *
 * `readAgain` must only bump state (a refresh sequence): it is taken from the render whose inputs
 * changed, which is the current one whenever it is called.
 */
export function useTaskReadAgainAfterReconnect(args: {
  key: string | null
  failed: boolean
  lastConnectedAt: number | null
  readAgain: () => void
}): void {
  const { key, failed, lastConnectedAt, readAgain } = args
  const ledgerRef = useRef(createStaleAfterReconnectLedger())

  useEffect(() => {
    if (
      key !== null &&
      shouldRefetchAfterReconnect(ledgerRef.current, key, failed ? 'error' : 'ready', lastConnectedAt)
    ) {
      readAgain()
    }
  }, [failed, key, lastConnectedAt])

  // A failure is judged against the connection it happened on only while its sheet stays open.
  // Reopened later, the item's read starts clean and a failure then is a new first sighting.
  useEffect(() => {
    const ledger = ledgerRef.current
    return () => {
      if (key !== null) {
        ledger.delete(key)
      }
    }
  }, [key])
}
