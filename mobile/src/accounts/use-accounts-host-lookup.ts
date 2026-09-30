import { useState } from 'react'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import type { HostLookup } from '../transport/host-lookup'
import { usePairedHostLookup } from '../transport/use-paired-host-lookup'

type AccountsHostLookup = {
  /** The desktop's name for the header, '' until the catalog has named it. */
  hostName: string
  /** Why this desktop cannot be opened, from the catalog; null while it reads or once it is readable. */
  hostNotice: string | null
}

type Known = AccountsHostLookup & { hostId: string }

const NOTHING_KNOWN: AccountsHostLookup = { hostName: '', hostNotice: null }

/**
 * What the Accounts screen says about its desktop. The catalog, not loadHosts(): a desktop whose
 * credential cannot be read is still paired and still has its name, so it is worded as unreadable,
 * not "Host not found". A failed lookup is read again once per new connection
 * (`usePairedHostLookup`), so the header names the desktop once it connects.
 */
export function useAccountsHostLookup(hostId: string | undefined): AccountsHostLookup {
  const lastConnectedAt = useLastConnectedAt(hostId)
  const [known, setKnown] = useState<Known | null>(null)
  usePairedHostLookup(hostId, lastConnectedAt, (lookup, lookedUp) => {
    setKnown((previous) => nextKnown(previous, lookup, lookedUp))
  })
  // Keyed by desktop: a screen reused for another one never shows the last one's name.
  return known !== null && known.hostId === hostId
    ? { hostName: known.hostName, hostNotice: known.hostNotice }
    : NOTHING_KNOWN
}

function nextKnown(previous: Known | null, lookup: HostLookup, hostId: string): Known {
  if (lookup.kind === 'ready') {
    return { hostId, hostName: lookup.host.name, hostNotice: null }
  }
  // 'not-listed' and 'failed' carry no name: keep the one this desktop was last named by.
  const hostName =
    lookup.kind === 'unavailable' || lookup.kind === 'missing'
      ? lookup.name
      : previous?.hostId === hostId
        ? previous.hostName
        : ''
  return { hostId, hostName, hostNotice: lookup.message }
}
