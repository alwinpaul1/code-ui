import type { RpcClient } from './rpc-client'

/**
 * The UI's live host clients, readable outside React.
 *
 * The provider keeps its clients in a ref inside the tree; the background
 * notification watcher lives outside it and, having no way to see them, opened
 * a SECOND client per host with the same device token every time the app left
 * the screen, then closed it on return. Measured on a Galaxy S23 behind a
 * relay: every background/foreground hand-back cost a fresh 2.3–3.2 s relay
 * dial (11 in 40 minutes), during which nothing arrived — and the bytes a PTY
 * emitted in that gap were never shown, because the replayed subscribe's
 * snapshot is dropped for a handle that is already initialised.
 *
 * The provider publishes here on every set and delete; the watcher borrows a
 * connected client when one exists and dials its own only when none does.
 */
const clients = new Map<string, RpcClient>()

export function publishLiveHostClient(hostId: string, client: RpcClient): void {
  clients.set(hostId, client)
}

export function retireLiveHostClient(hostId: string, client?: RpcClient): void {
  // A stale retire (an older client for the same host) must not evict a newer one.
  if (client && clients.get(hostId) !== client) {
    return
  }
  clients.delete(hostId)
}

export function peekLiveHostClient(hostId: string): RpcClient | null {
  return clients.get(hostId) ?? null
}

/** Test seam. */
export function clearLiveHostClientsForTest(): void {
  clients.clear()
}
