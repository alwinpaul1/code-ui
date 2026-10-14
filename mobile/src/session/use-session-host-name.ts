import { useEffect, useState } from 'react'
import { loadHosts } from '../transport/host-store'

/**
 * The paired desktop's name, as the user saw it when pairing, or null until the host store answers
 * (or when this host is not in it). Read once per host: the menu's "Reconnect from <host>" is the
 * only thing that wants it, and a name is never made up while the store has not answered.
 */
export function useSessionHostName(hostId: string | undefined): string | null {
  const [named, setNamed] = useState<{ hostId: string; name: string } | null>(null)
  useEffect(() => {
    if (!hostId) {
      return
    }
    let stale = false
    loadHosts()
      .then((hosts) => {
        const host = hosts.find((candidate) => candidate.id === hostId)
        if (!stale && host) {
          setNamed({ hostId, name: host.name })
        }
      })
      // An unreadable host store costs the host's name, nothing else: the line says Disconnected.
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [hostId])
  return named !== null && named.hostId === hostId ? named.name : null
}
