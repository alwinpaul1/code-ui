import { useEffect, useRef, useState } from 'react'
import { getCachedWorktrees } from '../cache/worktree-cache'
import { loadPinnedIds } from '../storage/preferences'
import { lookUpPairedHost } from '../transport/host-lookup'
import { updateLastConnected } from '../transport/host-store'
import type { RpcClient } from '../transport/rpc-client'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'
import type { Worktree } from '../worktree/workspace-list-sections'
import type { HostScreenState } from './use-host-screen-state'

export function useHostScreenIdentity(args: {
  client: RpcClient | null
  hostId: string | undefined
  /** Moves each time the host connects; a failed lookup is read again on the next one. */
  lastConnectedAt: number | null
  state: HostScreenState
}): void {
  const { client, hostId, lastConnectedAt, state } = args
  const {
    clientRef,
    repoMetadataFetchedAtRef,
    setCatalogError,
    setError,
    setHostLabelById,
    setHostName,
    setHostPlatform,
    setLastKnownWorktrees,
    setPinnedIds,
    setRepoColorsByName,
    setRepoHostIdByRepoId,
    setRepoIconsByName,
    setWorktrees,
    setWorktreesLoaded
  } = state
  // Which lookup of this desktop is current, and whether the last one could not name it.
  const [lookupRun, setLookupRun] = useState(0)
  const [lookupFailed, setLookupFailed] = useState(false)
  const staleLedgerRef = useRef(createStaleAfterReconnectLedger())

  // Load persisted pins from local cache; view settings are no longer local (they sync via ui.get).
  useEffect(() => {
    if (!hostId) {
      return
    }
    let stale = false
    void (async () => {
      const pins = await loadPinnedIds(hostId)
      if (stale) {
        return
      }
      setPinnedIds(pins)
    })()
    return () => {
      stale = true
    }
  }, [hostId])

  // Why: mirror client into a ref so imperative call sites read it without re-subscribing.
  useEffect(() => {
    clientRef.current = client
  }, [client])

  useEffect(() => {
    setHostName('')
    setError('')
    setRepoColorsByName(new Map())
    setRepoIconsByName(new Map())
    setRepoHostIdByRepoId(new Map())
    setHostLabelById(new Map())
    setHostPlatform(null)
    repoMetadataFetchedAtRef.current = 0
    // Why: useState initializer runs only on first mount, so re-seed the cache when Expo Router reuses this screen for a new hostId.
    const freshCache = hostId ? (getCachedWorktrees(hostId) as Worktree[] | null) : null
    setCatalogError(null)
    if (freshCache) {
      setWorktrees(freshCache)
      setLastKnownWorktrees(freshCache)
      setWorktreesLoaded(true)
    } else {
      setWorktreesLoaded(false)
      setWorktrees([])
      setLastKnownWorktrees([])
    }
    setLookupFailed(false)
  }, [hostId])

  // The catalog, not loadHosts(): a desktop whose credential cannot be read is still paired, and
  // "Host not found" over it took the whole screen for a desktop that only needed a moment.
  useEffect(() => {
    if (!hostId) {
      return
    }
    let stale = false
    void lookUpPairedHost(hostId).then((lookup) => {
      if (stale) {
        return
      }
      if (lookup.kind !== 'ready') {
        setLookupFailed(true)
        // A client for this desktop means the opener has read it, so a read that fails now neither
        // takes the screen from a connection that works nor keeps an older line up over one.
        setError(clientRef.current === null ? lookup.message : '')
        return
      }
      setLookupFailed(false)
      setError('')
      setHostName(lookup.host.name)
      void updateLastConnected(lookup.host.id)
    })
    return () => {
      stale = true
    }
  }, [hostId, lookupRun])

  // Nothing stays stale once the host connects: it can only connect after the opener has read its
  // credential, so a lookup that failed is read again, once per new connection, never per render.
  useEffect(() => {
    const status = lookupFailed ? 'error' : 'ready'
    if (
      hostId &&
      shouldRefetchAfterReconnect(staleLedgerRef.current, hostId, status, lastConnectedAt)
    ) {
      setLookupRun((run) => run + 1)
    }
  }, [hostId, lookupFailed, lastConnectedAt])
}
