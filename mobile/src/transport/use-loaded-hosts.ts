import { useEffect, useState } from 'react'
import { selectConnectableHostProfiles } from './host-catalog-selection'
import { loadHostCatalog } from './host-store'
import type { HostProfile } from './types'

export type LoadedHosts = {
  hosts: HostProfile[]
  loaded: boolean
  /** The read itself rejected: nothing is known about what is paired. */
  failed: boolean
  /** Listed desktops whose credential could not be read this time (locked or failing Keychain). */
  unavailable: number
  /** Listed desktops that have no credential at all: they must be paired again. */
  missing: number
}

const PENDING: LoadedHosts = { hosts: [], loaded: false, failed: false, unavailable: 0, missing: 0 }

// Why `loaded`: the list starts empty because the read has not finished, not
// because nothing is paired. A screen that words its empty state as a claim
// ("No paired desktops yet") must wait for `loaded`, or it states something
// untrue for the first moments of every visit.
//
// Why the catalog and not loadHosts(): loadHosts() silently drops a host whose
// Keychain read throws, so a locked Keychain returned [] for a phone with paired
// desktops. The catalog still lists them, which lets a screen say "can't be read
// right now" instead of "none".
//
// A failed read still ends the wait: `failed` is set and the failure logged, so a
// screen never hangs on loading and never mistakes a failed read for "none".
export function useLoadedHosts(): LoadedHosts {
  const [state, setState] = useState<LoadedHosts>(PENDING)
  useEffect(() => {
    let stale = false
    loadHostCatalog().then(
      (catalog) => {
        if (!stale) {
          const hosts = selectConnectableHostProfiles(catalog)
          setState({
            hosts,
            loaded: true,
            failed: false,
            unavailable: catalog.filter((e) => e.credentialStatus === 'temporarily-unavailable')
              .length,
            missing: catalog.filter((e) => e.credentialStatus === 'missing').length
          })
        }
      },
      (error: unknown) => {
        console.warn('[hosts] paired-host list failed to load', error)
        if (!stale) {
          setState({ hosts: [], loaded: true, failed: true, unavailable: 0, missing: 0 })
        }
      }
    )
    return () => {
      stale = true
    }
  }, [])
  return state
}

export const EMPTY_HOSTS_COPY = {
  failed: "Couldn't read your paired desktops. Reopen this screen in a moment.",
  unavailable: "Your paired desktops can't be read right now. Reopen this screen in a moment.",
  // Unlocking cannot fix this one: the credential is gone, so pairing is the way back.
  missing: 'A paired desktop needs to be paired again. Scan its code from the home screen.'
}

/**
 * The empty-list line for a screen: its own "none" copy only when none is the known answer,
 * and otherwise the state that is actually true for each desktop the catalog still lists.
 */
export function emptyHostsNoticeCopy(
  state: Pick<LoadedHosts, 'failed' | 'unavailable' | 'missing'>,
  noneCopy: string
): string {
  if (state.failed) {
    return EMPTY_HOSTS_COPY.failed
  }
  const parts: string[] = []
  if (state.unavailable > 0) {
    parts.push(EMPTY_HOSTS_COPY.unavailable)
  }
  if (state.missing > 0) {
    parts.push(EMPTY_HOSTS_COPY.missing)
  }
  return parts.length > 0 ? parts.join(' ') : noneCopy
}
