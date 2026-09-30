import { useCallback, useEffect, useRef, useState } from 'react'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import { HOST_LOOKUP_FAILED_COPY, lookUpPairedHost } from '../transport/host-lookup'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'
import type { BridgeInitHost } from './bridge/bridge-envelope'
import {
  hydrateMirroredStorage,
  readMirroredStorage,
  writeMirroredStorage
} from '../storage/mirrored-storage-keys'
import {
  isPageStorageKeyForRoute,
  pageStorageEntriesForInit,
  pageStorageKeysForRoute,
  type PageStorageForInit
} from './page-storage-keys'

export type PageHostSnapshot = {
  host: BridgeInitHost
}

export type PageHostSnapshotView = {
  /** Null while the profile read is in flight, while it cannot be read, and for an unlisted host. */
  snapshot: PageHostSnapshot | null
  /**
   * What to show instead of the page while the catalog lists this host but cannot hand over its
   * profile (a locked or failing Keychain, no credential at all), or the catalog read itself
   * rejected. No host is built without a profile, so without this the page sits behind its cover
   * with no host to answer its `ready`. Null when ready, in flight, or not listed.
   */
  unavailable: string | null
  /**
   * The allowlisted keys as the app currently holds them, for the host to put on every `init`.
   * Synchronous because `init` is; the app's own writers keep it current as they write.
   */
  readStorage: () => PageStorageForInit
  /** Re-seats that map on the app's store. Cheap, and asked for whenever a page asks to start. */
  refreshStorage: () => Promise<void>
  /** Applies one page write to the app's store and to the map the next `init` will carry. */
  writeStorage: (key: string, value: string | null) => void
}

/**
 * What the page cannot read for itself: this host, and the few stored keys its screens keep.
 *
 * `expo-secure-store` is `{}` on web and AsyncStorage's web build is `window.localStorage`, which
 * the page has none of — Android turns DOM storage off and on iOS the origin is the session id, so
 * a page-side write is gone on the next remount. Both cross in `init` instead.
 *
 * The profile is read from the catalog, not loadHosts(): loadHosts() drops a host whose Keychain
 * read throws, which left the snapshot null with nothing said and the page never handed `init`
 * over a desktop Home listed and the client had connected to (review, 2026-09-30). It is read once
 * per mount while it answers, because a host's identity does not change under one, and again once
 * per NEW connection while it does not: the client can only connect after its opener read the same
 * credential, so that is the moment it can be read here too. A profile that was read is never read
 * again, since the live page's host is keyed on this snapshot. The keys are re-seated per `init`
 * answer, because the store is their truth; between those reads the map is kept current by every
 * writer of one, which is what lets `init` stay synchronous.
 */
export function usePageHostSnapshot(hostId: string, routePathname: string): PageHostSnapshotView {
  const [snapshot, setSnapshot] = useState<PageHostSnapshot | null>(null)
  // Keyed by host, so another desktop starts with nothing to say, and never cleared by a re-read in
  // flight: the page would mount for the length of the read and come down again.
  const [unavailableFor, setUnavailableFor] = useState<{ hostId: string; message: string } | null>(
    null
  )
  const [readRun, setReadRun] = useState(0)
  const staleLedgerRef = useRef(createStaleAfterReconnectLedger())
  const lastConnectedAt = useLastConnectedAt(hostId)
  const unavailable = unavailableFor?.hostId === hostId ? unavailableFor.message : null

  // The allowlist is the shell's, not the mirror's: what the page may be handed is named here on
  // every read and every seat, so nothing else the app happens to mirror can reach it.
  const refreshStorage = useCallback(
    (): Promise<void> => hydrateMirroredStorage(pageStorageKeysForRoute(hostId, routePathname)),
    [hostId, routePathname]
  )

  useEffect(() => {
    let stale = false
    setSnapshot(null)
    // Both reads, not whichever answers first. The host is built from the snapshot and answers the
    // page's pending `ready` the moment it exists, so a profile that beat the store would put the
    // page's own keys behind an empty map: the list paints unpinned and the New Workspace drawer
    // opens on no repo until something else reconciles it. The lookup never rejects.
    void Promise.all([refreshStorage(), lookUpPairedHost(hostId)]).then(
      ([, lookup]) => {
        if (stale) {
          return
        }
        if (lookup.kind === 'ready') {
          const { id, name, endpoint, lastConnected } = lookup.host
          setSnapshot({ host: { id, name, endpoint, lastConnected } })
          setUnavailableFor(null)
          return
        }
        // Not listed is the one silent case: nothing is paired under this id to say anything of.
        if (lookup.kind === 'not-listed') {
          setUnavailableFor(null)
          return
        }
        console.warn('[web-shell] this paired desktop could not be read from the app store', {
          hostId,
          kind: lookup.kind
        })
        setUnavailableFor({ hostId, message: lookup.message })
      },
      (error: unknown) => {
        // Only the store re-seat is left to reject here. Said the way a failed catalog read is,
        // since no host is built without both reads.
        if (!stale) {
          console.warn('[web-shell] the page storage for this desktop could not be read', error)
          setUnavailableFor({ hostId, message: HOST_LOOKUP_FAILED_COPY })
        }
      }
    )
    return () => {
      stale = true
    }
  }, [hostId, refreshStorage, readRun])

  // CLAUDE.md "Nothing stays stale once the relay connects": one re-read per NEW connection while
  // the last read could not name a readable desktop, never one per render.
  useEffect(() => {
    const status = unavailable === null ? 'ready' : 'error'
    if (shouldRefetchAfterReconnect(staleLedgerRef.current, hostId, status, lastConnectedAt)) {
      setReadRun((run) => run + 1)
    }
  }, [hostId, unavailable, lastConnectedAt])

  const writeStorage = useCallback(
    (key: string, value: string | null): void => {
      // The host refuses a key outside this list before this ever runs. Held to it here too, so the
      // map cannot hold something the next refresh would drop and answer a read with it meanwhile.
      if (!isPageStorageKeyForRoute(key, hostId, routePathname)) {
        return
      }
      writeMirroredStorage(key, value)
    },
    [hostId, routePathname]
  )

  return {
    snapshot,
    unavailable,
    readStorage: useCallback(() => {
      // Bounded here rather than at the mirror, which holds no policy about the keys it is asked
      // for: a value over the cap would otherwise reach `init`, where the page's own schema
      // refuses the whole frame and the screen never opens. The name of what was left out is
      // reported rather than swallowed, because a preference falling back to its default is a
      // degradation someone has to be able to read.
      const held = readMirroredStorage(pageStorageKeysForRoute(hostId, routePathname))
      const { entries, dropped, oversize } = pageStorageEntriesForInit(held)
      if (dropped.length > 0) {
        console.warn('[web-shell] a stored value is too large for the page', { keys: dropped })
      }
      // `oversize` crosses as well as being logged: a key the page holds no value for is one its
      // own write would replace rather than extend (ruling 33.6).
      return { storage: entries, storageOversize: oversize }
    }, [hostId, routePathname]),
    refreshStorage,
    writeStorage
  }
}
