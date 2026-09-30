import { useEffect, useRef, useState } from 'react'
import { type HostLookup, lookUpPairedHost } from './host-lookup'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from './stale-after-reconnect'

/**
 * Looks one desktop up in the catalog for a screen opened on it, and again once per NEW connection
 * while the last lookup could not name a readable desktop.
 *
 * Why the re-read: a catalog read that rejects at open (a locked Keychain, storage still waking)
 * left Accounts with no name in its header and Edit host saying the desktop could not be read, for
 * as long as the screen stayed open, over a desktop that had connected since (review, 2026-09-30).
 * It can only connect after the client opener has read its credential, so a new connection is the
 * moment to look again. One read per connection, never per render (`shouldRefetchAfterReconnect`),
 * so a desktop that stays unreadable is not read in a loop. A lookup that was ready is never read
 * again, so a reconnect cannot overwrite a form the user is typing into.
 *
 * `onLookup` gets every lookup that is still current: one that lands after the screen moved to
 * another desktop is dropped. No host id, no lookup.
 */
export function usePairedHostLookup(
  hostId: string | undefined,
  lastConnectedAt: number | null,
  onLookup: (lookup: HostLookup, hostId: string) => void
): void {
  const [lookupRun, setLookupRun] = useState(0)
  // The desktop whose last lookup was not ready. Keyed by id, so another desktop starts clean.
  const [failedHostId, setFailedHostId] = useState<string | null>(null)
  const staleLedgerRef = useRef(createStaleAfterReconnectLedger())
  const onLookupRef = useRef(onLookup)
  useEffect(() => {
    onLookupRef.current = onLookup
  })

  useEffect(() => {
    if (!hostId) {
      return
    }
    let stale = false
    void lookUpPairedHost(hostId).then((lookup) => {
      if (stale) {
        return
      }
      setFailedHostId(lookup.kind === 'ready' ? null : hostId)
      onLookupRef.current(lookup, hostId)
    })
    return () => {
      stale = true
    }
  }, [hostId, lookupRun])

  useEffect(() => {
    const status = hostId !== undefined && failedHostId === hostId ? 'error' : 'ready'
    if (
      hostId &&
      shouldRefetchAfterReconnect(staleLedgerRef.current, hostId, status, lastConnectedAt)
    ) {
      setLookupRun((run) => run + 1)
    }
  }, [hostId, failedHostId, lastConnectedAt])
}
