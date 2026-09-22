import type { RpcClient } from './rpc-client'

/**
 * The UI's live host clients, readable outside React.
 *
 * The provider keeps its clients in a ref inside the tree; the background
 * notification watcher lives outside it and, having no way to see them, opened
 * a SECOND client per host with the same device token every time the app left
 * the screen. Measured on a Galaxy S23 over ten 10 s background cycles: ten
 * watcher dials, each a billed relay splice of 2.3–2.8 s, while the UI's own
 * session sat retained and connected the whole time — the relay allows both,
 * so nothing was evicted and nothing was lost; the second session was simply
 * redundant and paid for. (An earlier reading here blamed a resume hiccup and
 * dropped bytes; the device disproved both.)
 *
 * The provider publishes here on every set and delete; the watcher borrows a
 * connected client when one exists and dials its own only when none does.
 */
const clients = new Map<string, RpcClient>()
const clientIds = new Map<string, string>()

export function publishLiveHostClient(hostId: string, client: RpcClient, clientId?: string): void {
  clients.set(hostId, client)
  if (clientId !== undefined) {
    clientIds.set(hostId, clientId)
  }
}

export function peekLiveHostClientId(hostId: string): string {
  return clientIds.get(hostId) ?? ''
}

/** A socket the screen can take back after the React tree was destroyed.
 *  A dead or rejected one must be dialled again. */
export function reusableParkedHostClient(client: RpcClient | null): RpcClient | null {
  if (!client) {
    return null
  }
  const state = client.getState()
  if (state === 'disconnected' || state === 'auth-failed') {
    return null
  }
  return client
}

export function retireLiveHostClient(hostId: string, client?: RpcClient): void {
  // A stale retire (an older client for the same host) must not evict a newer one.
  if (client && clients.get(hostId) !== client) {
    return
  }
  clients.delete(hostId)
  clientIds.delete(hostId)
}

export function peekLiveHostClient(hostId: string): RpcClient | null {
  return clients.get(hostId) ?? null
}

/** Test seam. */
export function clearLiveHostClientsForTest(): void {
  clients.clear()
  clientIds.clear()
}
