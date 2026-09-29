import { useEffect, useState } from 'react'
import { selectConnectableHostProfiles } from './host-catalog-selection'
import { loadHostCatalog } from './host-store'
import type { HostProfile } from './types'

export type LoadedHosts = {
  hosts: HostProfile[]
  loaded: boolean
  /** The read itself rejected: nothing is known about what is paired. */
  failed: boolean
  /** Paired desktops the catalog lists but whose credential cannot be read right now. */
  unreadable: number
}

const PENDING: LoadedHosts = { hosts: [], loaded: false, failed: false, unreadable: 0 }

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
            unreadable: catalog.length - hosts.length
          })
        }
      },
      (error: unknown) => {
        console.warn('[hosts] paired-host list failed to load', error)
        if (!stale) {
          setState({ hosts: [], loaded: true, failed: true, unreadable: 0 })
        }
      }
    )
    return () => {
      stale = true
    }
  }, [])
  return state
}

export type EmptyHostsNotice = 'none' | 'unreadable' | 'failed'

/** What an empty host list may truthfully say once it has loaded. */
export function emptyHostsNotice(
  state: Pick<LoadedHosts, 'failed' | 'unreadable'>
): EmptyHostsNotice {
  if (state.failed) {
    return 'failed'
  }
  return state.unreadable > 0 ? 'unreadable' : 'none'
}

export const EMPTY_HOSTS_UNKNOWN_COPY: Record<Exclude<EmptyHostsNotice, 'none'>, string> = {
  unreadable:
    "Your paired desktops can't be read right now. Unlock your phone and reopen this screen.",
  failed: "Couldn't read your paired desktops. Reopen this screen in a moment."
}

/** The empty-list line for a screen: its own "none" copy only when none is the known answer. */
export function emptyHostsNoticeCopy(
  state: Pick<LoadedHosts, 'failed' | 'unreadable'>,
  noneCopy: string
): string {
  const notice = emptyHostsNotice(state)
  return notice === 'none' ? noneCopy : EMPTY_HOSTS_UNKNOWN_COPY[notice]
}
