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
