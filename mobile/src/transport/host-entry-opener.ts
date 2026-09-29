import {
  peekLiveHostClient,
  peekLiveHostClientId,
  publishLiveHostClient,
  retireLiveHostClient,
  reusableParkedHostClient
} from './live-host-clients'
import {
  connectionLogStore,
  recordConnectionClientSessionStart
} from './persisted-connection-log-store'
import { loadHostCatalog } from './host-store'
import { openHostLogicalClient } from './host-logical-client'
import type { HostClientOpenRegistry } from './host-client-open-registry'
import type { HostOpenRetryScheduler } from './host-open-retry-scheduler'
import type { RpcClient } from './rpc-client'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'
import type { ConnectionState, HostCatalogEntry, HostProfile } from './types'

export type HostClientStoreEntry = {
  client: RpcClient
  clientId: string
  state: ConnectionState
  refCount: number
  unsubState: () => void
  unsubConnectionPath: () => void
  unsubLivenessProbing: () => void
}

type HostEntryOpenerState = {
  store: Map<string, HostClientStoreEntry>
  pendingOpens: HostClientOpenRegistry
  pendingAcquisitions: Map<string, number>
  primedHosts: Map<string, HostProfile>
  retryScheduler: HostOpenRetryScheduler
  notifyHostState: (hostId: string, state: ConnectionState) => void
  notifyAllHosts: () => void
}

// The detail line the diagnostics timeline draws under "Host client open failed". A listed desktop
// whose credential cannot be read is not "host-not-found": that line sent readers looking for a
// removed host under a locked Keychain (review, 2026-09-30).
type HostOpenFailureCategory =
  | 'catalog-unavailable'
  | 'host-not-found'
  | 'credential-unavailable'
  | 'credential-missing'
  | 'client-construction'

export async function openHostClientEntry(
  state: HostEntryOpenerState,
  hostId: string,
  allowUnowned = false
): Promise<HostClientStoreEntry | null> {
  const existing = state.pendingOpens.getActivePromise(hostId)
  if (existing) {
    await existing
    return state.store.get(hostId) ?? null
  }
  let resolve: () => void = () => {}
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  const ticket = state.pendingOpens.register(hostId, promise)
  let settled = false
  const settle = () => {
    if (settled) {
      return
    }
    settled = true
    state.pendingOpens.deleteIfCurrent(hostId, ticket)
    resolve()
  }
  const isCurrent = () => state.pendingOpens.isCurrent(hostId, ticket)
  const isWanted = () => allowUnowned || (state.pendingAcquisitions.get(hostId) ?? 0) > 0
  const registered = peekLiveHostClient(hostId)
  let parked = reusableParkedHostClient(registered)
  if (registered && !parked && !state.store.has(hostId)) {
    // A parked socket that died while no screen held it is not closed: its
    // reconnect loop and relay supervisor keep running. Dialling beside it
    // and publishing over it left it running for the life of the process.
    retireLiveHostClient(hostId, registered)
    registered.close()
  }
  const failCurrentOpen = (category: HostOpenFailureCategory) => {
    if (!isCurrent()) {
      return
    }
    settle()
    state.notifyHostState(hostId, 'disconnected')
    state.notifyAllHosts()
    const retry = state.retryScheduler.recordFailure(hostId, ticket.generation)
    connectionLogStore.append(hostId, {
      id: `host-open-${ticket.generation}-${Date.now()}`,
      ts: Date.now(),
      level: 'error',
      code: 'host-open-failed',
      message: 'Host client open failed',
      detail: `${category}; retry ${retry.nextDelayMs}ms (failure ${retry.failureCount})`
    })
  }
  if (!parked) {
    state.notifyHostState(hostId, 'connecting')
  }

  try {
    let host = state.primedHosts.get(hostId)
    if (!host) {
      let entry: HostCatalogEntry | undefined
      try {
        entry = (await loadHostCatalog()).find((candidate) => candidate.id === hostId)
      } catch {
        failCurrentOpen('catalog-unavailable')
        return null
      }
      // The same profile loadHosts() hands back: it lists exactly the entries that carry one.
      host = entry?.profile ?? undefined
      if (!host) {
        failCurrentOpen(
          entry === undefined
            ? 'host-not-found'
            : entry.credentialStatus === 'missing'
              ? 'credential-missing'
              : 'credential-unavailable'
        )
        return null
      }
    }
    if (!isCurrent() || !isWanted()) {
      return null
    }
    // The catalog read can outlive the socket. Adopting the client captured
    // before that read stored an auth-failed relay and called it a success.
    const stillParked = reusableParkedHostClient(peekLiveHostClient(hostId))
    if (parked && parked !== stillParked) {
      if (peekLiveHostClient(hostId) === parked) {
        retireLiveHostClient(hostId, parked)
      }
      parked.close()
      if (!stillParked && isCurrent()) {
        state.notifyHostState(hostId, 'connecting')
      }
    }
    parked = stillParked
    const published = state.store.get(hostId)
    if (published) {
      settle()
      state.retryScheduler.recordSuccess(hostId)
      return published
    }

    let client: RpcClient
    if (parked) {
      client = parked
    } else {
      try {
        recordConnectionClientSessionStart(hostId)
        client = openHostLogicalClient(host, (entry) => connectionLogStore.append(hostId, entry))
      } catch {
        failCurrentOpen('client-construction')
        return null
      }
    }
    if (!isCurrent() || !isWanted() || state.store.has(hostId)) {
      if (!parked) {
        client.close()
      }
      return state.store.get(hostId) ?? null
    }
    const unsubState = client.onStateChange((next) => {
      const current = state.store.get(hostId)
      if (!current) {
        return
      }
      current.state = next
      state.notifyHostState(hostId, next)
    })
    const logical = client as Partial<StableLogicalRpcClient>
    const unsubConnectionPath =
      logical.onConnectionPathChange?.(() => {
        const current = state.store.get(hostId)
        if (current) {
          state.notifyHostState(hostId, current.state)
        }
      }) ?? (() => {})
    // A probe going out or coming back changes the label, not the state.
    const unsubLivenessProbing =
      logical.onLivenessProbingChange?.(() => {
        const current = state.store.get(hostId)
        if (current) {
          state.notifyHostState(hostId, current.state)
        }
      }) ?? (() => {})
    const entry: HostClientStoreEntry = {
      client,
      clientId: (parked ? peekLiveHostClientId(hostId) : '') || host.deviceToken,
      state: client.getState(),
      refCount: state.pendingAcquisitions.get(hostId) ?? 0,
      unsubState,
      unsubConnectionPath,
      unsubLivenessProbing
    }
    state.pendingAcquisitions.delete(hostId)
    state.store.set(hostId, entry)
    publishLiveHostClient(hostId, client, entry.clientId)
    settle()
    const priorFailureCount = state.retryScheduler.recordSuccess(hostId)
    if (priorFailureCount > 0) {
      connectionLogStore.append(hostId, {
        id: `host-open-recovered-${ticket.generation}-${Date.now()}`,
        ts: Date.now(),
        level: 'success',
        message: 'Host client recovered',
        detail: `after ${priorFailureCount} failed open${priorFailureCount === 1 ? '' : 's'}`
      })
    }
    state.notifyHostState(hostId, entry.state)
    state.notifyAllHosts()
    return entry
  } finally {
    settle()
  }
}
