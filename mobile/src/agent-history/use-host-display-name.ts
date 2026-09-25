import { useEffect, useState } from 'react'
import { loadHosts } from '../transport/host-store'
import { UNNAMED_HOST_LABEL } from './agent-history-search-view'

/**
 * The paired host's own display name, the one the phone already shows for it, for sentences like
 * "Session search is off on <name>".
 *
 * Never "Mac", "PC" or any platform word: the host may run Orca on macOS, Windows or Linux, and the
 * name is the one thing the user chose for it. Until the store answers, or when the host has no name
 * (or the store cannot be read), the copy says "this computer" rather than guessing.
 */
export function useHostDisplayName(hostId: string): string {
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    setName(null)
    loadHosts()
      .then((hosts) => {
        if (!stale) {
          setName(hosts.find((host) => host.id === hostId)?.name.trim() || null)
        }
      })
      .catch(() => {
        // The name is decoration on a sentence that reads without it.
      })
    return () => {
      stale = true
    }
  }, [hostId])

  return name ?? UNNAMED_HOST_LABEL
}
