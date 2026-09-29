import { useEffect, useState } from 'react'
import { loadHosts } from './host-store'
import type { HostProfile } from './types'

// Why `loaded`: the list starts empty because the read has not finished, not
// because nothing is paired. A screen that words its empty state as a claim
// ("No paired desktops yet") must wait for `loaded`, or it states something
// untrue for the first moments of every visit.
//
// A failed read still ends the wait: the hosts stay empty and the failure is
// logged, so a screen never hangs on its loading state. Empty is then the
// honest fallback, because nothing else can be listed.
export function useLoadedHosts(): { hosts: HostProfile[]; loaded: boolean } {
  const [state, setState] = useState<{ hosts: HostProfile[]; loaded: boolean }>({
    hosts: [],
    loaded: false
  })
  useEffect(() => {
    let stale = false
    loadHosts().then(
      (hosts) => {
        if (!stale) {
          setState({ hosts, loaded: true })
        }
      },
      (error: unknown) => {
        console.warn('[hosts] paired-host list failed to load; treating it as empty', error)
        if (!stale) {
          setState({ hosts: [], loaded: true })
        }
      }
    )
    return () => {
      stale = true
    }
  }, [])
  return state
}
