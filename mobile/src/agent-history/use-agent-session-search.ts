import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiVaultSearchSort } from '../../../src/shared/ai-vault-types'
import type { RpcClient } from '../transport/rpc-client'
import { isMethodNotFoundRefusal } from '../transport/rpc-acceptance-policies'
import { isMobileScopeRefusal } from '../transport/mobile-scope-refusal'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'
import { agentSessionSearch } from './agent-history-search-operations'
import type { AgentSessionSearchResponse } from './agent-history-search-reply-schema'
import type { SearchIndexKind } from './agent-history-search-index-state'
import {
  firstPageSearchState,
  nextPageSearchState,
  shouldRerunSearchForIndex,
  type SessionSearchState
} from './agent-history-search-state'

/** The desktop's debounce (use-ai-vault-search.ts): one request per pause in typing. */
export const SESSION_SEARCH_DEBOUNCE_MS = 250
/** A page a phone screen can hold; the host caps it too (SESSION_SEARCH_LIMIT_MAX). */
export const SESSION_SEARCH_PAGE_SIZE = 20
const SESSION_SEARCH_TIMEOUT_MS = 30_000

type SearchParams = {
  client: RpcClient | null
  connected: boolean
  lastConnectedAt: number | null
  query: string
  /** The scope's cwd prefixes, empty for All. The host narrows hits to them. */
  scopePaths: readonly string[]
  sort: AiVaultSearchSort
  indexKind: SearchIndexKind
}

type SearchRequest = {
  query: string
  limit: number
  cursor?: string
  filters?: { scopePaths?: string[]; sort?: AiVaultSearchSort }
}

/**
 * One session search against the host's index: debounced, paged, and re-run by itself when the
 * connection comes back or the index turns on.
 *
 * It follows the desktop's hook where the two can share a rule: relevance is the host's default,
 * so only Newest travels; a stale cursor re-runs page one and replaces the list; a search that
 * failed leaves an error rather than an empty list. It departs in two places. A load-more that
 * fails keeps the pages already on screen. And a search that failed while the relay was down is
 * run again once per new connection (`shouldRefetchAfterReconnect`), because "Could not search"
 * over a connection that has been healthy for minutes is the screen lying.
 */
export function useAgentSessionSearch(params: SearchParams): {
  state: SessionSearchState
  loadMore: () => void
  retry: () => void
  refresh: () => Promise<void>
} {
  const { client, connected, lastConnectedAt, query, scopePaths, sort, indexKind } = params
  const scopeKey = scopePaths.join('\n')
  const request = useMemo<SearchRequest>(() => {
    const paths = scopeKey ? scopeKey.split('\n') : []
    const filters = {
      ...(paths.length > 0 ? { scopePaths: paths } : {}),
      ...(sort === 'relevance' ? {} : { sort })
    }
    return {
      query,
      limit: SESSION_SEARCH_PAGE_SIZE,
      ...(Object.keys(filters).length > 0 ? { filters } : {})
    }
  }, [query, scopeKey, sort])

  const [state, setState] = useState<SessionSearchState>({ kind: 'searching' })
  const [revision, setRevision] = useState(0)
  const stateRef = useRef(state)
  const loadPageRef = useRef<((cursor: string) => void) | null>(null)
  const settledWaitersRef = useRef<(() => void)[]>([])
  const ledgerRef = useRef(createStaleAfterReconnectLedger())
  const indexKindRef = useRef(indexKind)

  useEffect(() => {
    stateRef.current = state
    if (state.kind !== 'searching' && !(state.kind === 'results' && state.loadingMore)) {
      const waiters = settledWaitersRef.current.splice(0)
      for (const settle of waiters) {
        settle()
      }
    }
  }, [state])

  useEffect(() => {
    if (!client || !connected) {
      setState({ kind: 'waiting' })
      return
    }
    let cancelled = false
    let pending = false
    const send = (cursor?: string): Promise<AgentSessionSearchResponse | 'unsupported'> =>
      agentSessionSearch
        .request(client, cursor ? { ...request, cursor } : request, {
          timeoutMs: SESSION_SEARCH_TIMEOUT_MS
        })
        .then((reply) =>
          isMethodNotFoundRefusal(reply) || isMobileScopeRefusal(reply)
            ? 'unsupported'
            : agentSessionSearch.interpret(reply)
        )

    const runFirstPage = async (): Promise<void> => {
      pending = true
      try {
        const response = await send()
        if (!cancelled) {
          setState(response === 'unsupported' ? { kind: 'unsupported' } : firstPageSearchState(response))
        }
      } catch (error) {
        if (!cancelled) {
          setState({ kind: 'failed', message: searchErrorMessage(error) })
        }
      } finally {
        pending = false
      }
    }

    const runNextPage = async (cursor: string): Promise<void> => {
      const onScreen = stateRef.current
      if (pending || cancelled || onScreen.kind !== 'results') {
        return
      }
      pending = true
      setState({ ...onScreen, loadingMore: true, loadMoreError: null })
      try {
        const response = await send(cursor)
        if (cancelled) {
          return
        }
        const next =
          response === 'unsupported'
            ? { kind: 'unsupported' as const }
            : nextPageSearchState(onScreen, response)
        if (next !== 'restart') {
          setState(next)
          return
        }
        // The index moved on since page one: start over rather than splice two generations.
        const restarted = await send()
        if (!cancelled) {
          setState(
            restarted === 'unsupported' ? { kind: 'unsupported' } : firstPageSearchState(restarted)
          )
        }
      } catch (error) {
        if (!cancelled) {
          // The pages already drawn are still true; only the next one failed.
          setState({ ...onScreen, loadingMore: false, loadMoreError: searchErrorMessage(error) })
        }
      } finally {
        pending = false
      }
    }

    setState({ kind: 'searching' })
    loadPageRef.current = (cursor) => void runNextPage(cursor)
    const timer = setTimeout(() => void runFirstPage(), SESSION_SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      loadPageRef.current = null
      clearTimeout(timer)
    }
  }, [client, connected, request, revision])

  // A failed search is run again once per NEW connection, never once per render.
  useEffect(() => {
    const status =
      state.kind === 'failed' ? 'error' : state.kind === 'searching' ? 'loading' : 'ready'
    if (shouldRefetchAfterReconnect(ledgerRef.current, 'search', status, lastConnectedAt)) {
      setRevision((value) => value + 1)
    }
  }, [state, lastConnectedAt])

  // Search turned on (or finished building) at the desktop: ask again without a tap.
  useEffect(() => {
    const previous = indexKindRef.current
    indexKindRef.current = indexKind
    if (shouldRerunSearchForIndex(previous, indexKind, stateRef.current)) {
      setRevision((value) => value + 1)
    }
  }, [indexKind])

  const retry = useCallback(() => setRevision((value) => value + 1), [])
  const loadMore = useCallback(() => {
    const onScreen = stateRef.current
    if (onScreen.kind === 'results' && onScreen.hasMore && onScreen.cursor && !onScreen.loadingMore) {
      loadPageRef.current?.(onScreen.cursor)
    }
  }, [])
  const refresh = useCallback(
    () =>
      new Promise<void>((resolve) => {
        settledWaitersRef.current.push(resolve)
        setRevision((value) => value + 1)
      }),
    []
  )

  // Settle any pull-to-refresh still waiting when the panel goes away.
  useEffect(
    () => () => {
      for (const settle of settledWaitersRef.current.splice(0)) {
        settle()
      }
    },
    []
  )

  return { state, loadMore, retry, refresh }
}

function searchErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'No reply from the host.'
}
