import { useEffect, useState } from 'react'
import { decodeAccountsSnapshot, type AccountsSnapshot } from '../components/accounts-snapshot'
import type { RpcClient } from '../transport/rpc-client'

/**
 * The host's account snapshot for one connected client, kept live through the
 * same `accounts.subscribe` the home screen uses. Zero host setup: the host
 * computes the rate-limit windows itself.
 */
export function useHostAccountsSnapshot(
  client: RpcClient | null,
  enabled: boolean
): AccountsSnapshot | null {
  const [snapshot, setSnapshot] = useState<AccountsSnapshot | null>(null)
  useEffect(() => {
    if (!client || !enabled) {
      setSnapshot(null)
      return
    }
    let active = true
    // Why the guard: some session hook tests hand in a client that only sends.
    const subscribe = (client as Partial<RpcClient>).subscribe
    if (typeof subscribe !== 'function') {
      return
    }
    const unsubscribe = subscribe('accounts.subscribe', null, (payload) => {
      if (!active || !payload || typeof payload !== 'object') {
        return
      }
      const event = payload as { type?: string; snapshot?: unknown }
      if (event.type !== 'ready' && event.type !== 'snapshot') {
        return
      }
      try {
        setSnapshot(decodeAccountsSnapshot(event.snapshot))
      } catch {
        // Keep the last proven snapshot when a mixed-version host publishes malformed data.
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [client, enabled])
  return snapshot
}
