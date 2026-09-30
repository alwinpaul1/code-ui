import { useEffect, useMemo, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { connectionRetryAction } from '../transport/connection-retry-action'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'
import { useMobileNativeChatFileSearch } from '../session/use-mobile-native-chat-file-search'
import type { DirectoryCache } from './file-tree'
import {
  collectCachedFilePaths,
  filterFilePathsLocally,
  mergeFileSearchResults
} from './file-search-local'

// Why: the host's `files.searchPaths` schema rejects anything above 32.
const SEARCH_RESULT_LIMIT = 32

/**
 * The Files explorer's search: the query, the host path search the composer's `@` menu uses, the
 * names already listed on the phone, and what to do when the host search failed.
 *
 * A failed search is not "No matches": `searchFailed` says so, `searchRetry` runs it again (or
 * re-dials a parked connection), and a failed query runs again by itself once per NEW connection.
 * The explorer runs its search only when the query changes, so a query typed while the relay was
 * down used to stay failed after the connection came back, until the user edited it. The ledger
 * (stale-after-reconnect.ts) retries only when `lastConnectedAt` moves: never once per render,
 * never in a loop while the host is down.
 *
 * `lastConnectedAt` is read off the client, as the search hook itself does to retire its cache,
 * rather than through useLastConnectedAt: the screen re-renders on every connection change
 * (useHostClient), and the host-client context the explorer's RPC recordings mount has no
 * connection metrics to read.
 */
export function useMobileFileExplorerSearch(args: {
  hostId: string
  worktreeId: string
  client: RpcClient | null
  connState: ConnectionState
  forceReconnect: ((hostId: string) => unknown) | null
  directoryCache: DirectoryCache
}) {
  const { hostId, worktreeId, client, connState, forceReconnect, directoryCache } = args
  const [searchQuery, setSearchQuery] = useState('')
  const trimmedSearch = searchQuery.trim()
  const {
    nativeChatFilePaths: searchResults,
    nativeChatFileSearchPending: searchPending,
    nativeChatFileSearchFailed: searchFailed,
    loadNativeChatFiles: runSearch
  } = useMobileNativeChatFileSearch({ client, worktreeId, limit: SEARCH_RESULT_LIMIT })
  useEffect(() => {
    if (trimmedSearch) {
      runSearch(trimmedSearch)
    }
  }, [runSearch, trimmedSearch])

  const lastConnectedAt =
    client && typeof client.getLastConnectedAt === 'function' ? client.getLastConnectedAt() : null
  const ledgerRef = useRef(createStaleAfterReconnectLedger())
  const status = searchFailed ? 'error' : searchPending ? 'loading' : 'ready'
  useEffect(() => {
    if (
      trimmedSearch &&
      shouldRefetchAfterReconnect(ledgerRef.current, trimmedSearch, status, lastConnectedAt)
    ) {
      runSearch(trimmedSearch)
    }
  }, [lastConnectedAt, runSearch, status, trimmedSearch])

  // Why: names already listed on the phone match instantly with no round trip;
  // the host search only adds files in folders that were never expanded.
  const cachedFilePaths = useMemo(() => collectCachedFilePaths(directoryCache), [directoryCache])
  const localMatches = useMemo(
    () => (trimmedSearch ? filterFilePathsLocally(cachedFilePaths, trimmedSearch) : []),
    [cachedFilePaths, trimmedSearch]
  )
  const mergedSearchResults = useMemo(
    () => mergeFileSearchResults(localMatches, searchResults),
    [localMatches, searchResults]
  )

  // While disconnected, re-sending is useless: revive the parked transport instead (issue #5049),
  // and the reconnect runs the search again. Null on the page, where nothing re-dials.
  const searchRetry = connectionRetryAction({
    hostId,
    needsReconnect: connState !== 'connected',
    forceReconnect,
    reload: () => runSearch(trimmedSearch)
  })

  return {
    searchQuery,
    setSearchQuery,
    trimmedSearch,
    mergedSearchResults,
    searchPending,
    searchFailed,
    searchRetry
  }
}
