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
 * The provider publishes here on every set and delete. A client is either HELD
 * (the screen's store has it as an entry) or PARKED (the tree that held it is
 * gone, and the next open takes it back). There is at most one client per
 * host: the watcher borrows whatever is here, and a client it had to dial
 * itself is parked on hand-back only when the screen holds none.
 */
const clients = new Map<string, RpcClient>()
const clientIds = new Map<string, string>()
const parkedHostIds = new Set<string>()
const retiredListeners = new Set<(hostId: string, client: RpcClient) => void>()

/**
 * Told when a client leaves the registry: its holder closed or replaced it.
 * The background watcher may be borrowing it. A Recents swipe closes a dead
 * entry rather than parking it, and the watcher then held a closed link and
 * listened for nothing until the app was opened (review, 2026-09-27).
 */
export function subscribeLiveHostClientRetired(
  listener: (hostId: string, client: RpcClient) => void
): () => void {
  retiredListeners.add(listener)
  return () => retiredListeners.delete(listener)
}

/** The screen's store has taken this client as its entry for the host. */
export function publishLiveHostClient(hostId: string, client: RpcClient, clientId?: string): void {
  clients.set(hostId, client)
  parkedHostIds.delete(hostId)
  if (clientId !== undefined) {
    clientIds.set(hostId, clientId)
  }
}

/** The tree that held this client is gone; it waits here for the next open. */
export function parkLiveHostClient(hostId: string, client: RpcClient): void {
  if (clients.get(hostId) === client) {
    parkedHostIds.add(hostId)
  }
}

/** Whether a mounted screen holds the host's client, as opposed to it being parked. */
export function isLiveHostClientHeldByScreen(hostId: string): boolean {
  return clients.has(hostId) && !parkedHostIds.has(hostId)
}

/**
 * The background watcher is giving back a client it dialled itself.
 *
 * Returns false when the host already has its one client: the screen holds an
 * entry (acquire returns that entry, never this one), or a live client is
 * parked here already. The caller must close its client then — publishing it
 * anyway orphaned it with its reconnect loop, relay supervisor and credential
 * copy still running, one more per hide/show (Pixel diagnostics, 2026-09-27).
 *
 * A parked client that is dead is closed here: nothing holds it, so nothing
 * else ever would.
 */
export function handBackLiveHostClient(hostId: string, client: RpcClient): boolean {
  const current = clients.get(hostId)
  if (current && current !== client) {
    if (!parkedHostIds.has(hostId) || reusableParkedHostClient(current)) {
      return false
    }
    retireLiveHostClient(hostId, current)
    current.close()
  }
  clients.set(hostId, client)
  parkedHostIds.add(hostId)
  return true
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
  const retired = clients.get(hostId)
  clients.delete(hostId)
  clientIds.delete(hostId)
  parkedHostIds.delete(hostId)
  if (retired) {
    for (const listener of retiredListeners) {
      listener(hostId, retired)
    }
  }
}

export function peekLiveHostClient(hostId: string): RpcClient | null {
  return clients.get(hostId) ?? null
}

/** Test seam. */
export function clearLiveHostClientsForTest(): void {
  clients.clear()
  clientIds.clear()
  parkedHostIds.clear()
}
