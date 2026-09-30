import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  GenerationScopedRequestOwner,
  type RequestScope
} from '../transport/generation-scoped-request-owner'
import {
  nativeChatFileInventoryRead,
  nativeChatFileSearchRead
} from './mobile-session-read-operations'
import { rankSuggestions } from './mobile-native-chat-autocomplete'

const FILE_SEARCH_DEBOUNCE_MS = 120
const FILE_SEARCH_RESULT_LIMIT = 16
const FILE_SEARCH_QUERY_CACHE_LIMIT = 20
/**
 * How long a cached answer (a query's result, or an older host's whole
 * workspace list) is served without asking the host again. Past it the cached
 * list still shows at once, and the host is asked in the background. Mentioning
 * the file the agent just wrote is a core flow, and a cache that never expired
 * never offered it.
 */
const FILE_SEARCH_CACHE_TTL_MS = 10_000

/** The legacy inventory is the whole workspace, so its request carries no further parameters. */
type WorkspaceInventoryParameters = Readonly<Record<string, never>>
const WHOLE_WORKSPACE: WorkspaceInventoryParameters = {}

type CachedQuery = { paths: string[]; at: number }

/** When the host last connected. A new connection retires what the old one
 *  answered. A client without the accessor (a test fake) never retires on it. */
function lastConnectedAt(client: RpcClient): number | null {
  return typeof client.getLastConnectedAt === 'function' ? client.getLastConnectedAt() : null
}

const isFresh = (at: number | null): boolean => at !== null && Date.now() - at < FILE_SEARCH_CACHE_TTL_MS

/** Debounces current-host path searches, bounds the mobile result/cache, and
 *  falls back to the legacy full list when paired to an older host. A cached
 *  answer is served at once and asked for again past FILE_SEARCH_CACHE_TTL_MS
 *  or after a reconnect; an empty one is never served from the cache; a failed
 *  refresh keeps what was shown. A search that ended with no answer at all
 *  raises `nativeChatFileSearchFailed` and logs its cause once. */
export function useMobileNativeChatFileSearch(args: {
  client: RpcClient | null
  worktreeId: string
  /** Result cap; the composer's `@` menu keeps the small default, the file
   *  explorer's search asks for more since it has the whole screen. */
  limit?: number
}): {
  nativeChatFilePaths: string[]
  /** A debounced or in-flight search has not answered yet; an empty list then
   *  means "still looking", not "nothing matched". */
  nativeChatFileSearchPending: boolean
  /** The latest search ended with no answer (a rejected request, a refusal other
   *  than method_not_found, a refused legacy list), so an empty list is NOT
   *  "nothing matched". False again as soon as the next search starts. */
  nativeChatFileSearchFailed: boolean
  loadNativeChatFiles: (query: string) => void
} {
  const { client, worktreeId } = args
  const limit = args.limit ?? FILE_SEARCH_RESULT_LIMIT
  const [nativeChatFilePaths, setNativeChatFilePaths] = useState<string[]>([])
  const [nativeChatFileSearchPending, setNativeChatFileSearchPending] = useState(false)
  const [nativeChatFileSearchFailed, setNativeChatFileSearchFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sequenceRef = useRef(0)
  const queryCacheRef = useRef(new Map<string, CachedQuery>())
  // When the held legacy inventory was read; null once a reconnect made it stale.
  const inventoryReadAtRef = useRef<number | null>(null)
  // The connection the caches were filled under; undefined before the first query.
  const connectedAtRef = useRef<number | null | undefined>(undefined)
  const searchSupportedRef = useRef<boolean | null>(null)
  const inventory = useRef(
    new GenerationScopedRequestOwner<WorkspaceInventoryParameters, string[]>()
  ).current

  useEffect(() => {
    sequenceRef.current++
    queryCacheRef.current.clear()
    inventoryReadAtRef.current = null
    connectedAtRef.current = undefined
    searchSupportedRef.current = null
    setNativeChatFilePaths([])
    setNativeChatFileSearchPending(false)
    setNativeChatFileSearchFailed(false)
    return () => {
      // The owner retires itself the moment a call arrives under a scope it has not seen; this is
      // the teardown path, where no such call is coming.
      inventory.reset()
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [client, inventory, worktreeId])

  const loadNativeChatFiles = useCallback(
    (query: string) => {
      if (!client) {
        return
      }
      const connectedAt = lastConnectedAt(client)
      if (connectedAt !== connectedAtRef.current) {
        // A new connection: what the host answered before it may be out of date.
        connectedAtRef.current = connectedAt
        queryCacheRef.current.clear()
        inventoryReadAtRef.current = null
      }
      const normalizedQuery = query.trim().toLowerCase().slice(0, 256)
      const cached = queryCacheRef.current.get(normalizedQuery)
      // Why: cancel and stale-out any in-flight debounced query so an older
      // request cannot later clobber what is displayed now.
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const sequence = ++sequenceRef.current
      setNativeChatFileSearchFailed(false)
      // Whether this search has shown an answer (the cache's counts); only one that
      // ends without any is a failure.
      let answered = cached !== undefined
      // Why no answer came, for the one log line a failure leaves.
      let unanswered = 'no answer'
      if (cached) {
        setNativeChatFilePaths(cached.paths)
        setNativeChatFileSearchPending(false)
        if (isFresh(cached.at)) {
          return
        }
      } else {
        setNativeChatFilePaths([])
        setNativeChatFileSearchPending(true)
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const applyPaths = (paths: string[], at: number): void => {
          if (sequenceRef.current !== sequence) {
            return
          }
          // Re-inserted, so the eviction below drops the least recently answered.
          queryCacheRef.current.delete(normalizedQuery)
          // An empty answer is never served from the cache: the file it missed
          // may be the one the agent is writing.
          if (paths.length > 0) {
            queryCacheRef.current.set(normalizedQuery, { paths, at })
          }
          while (queryCacheRef.current.size > FILE_SEARCH_QUERY_CACHE_LIMIT) {
            const oldest = queryCacheRef.current.keys().next().value as string | undefined
            if (!oldest) {
              break
            }
            queryCacheRef.current.delete(oldest)
          }
          answered = true
          setNativeChatFilePaths(paths)
          setNativeChatFileSearchPending(false)
        }
        const loadLegacyPaths = async (): Promise<void> => {
          // What retires the inventory: this host, this workspace, this logical authority. The
          // physical session epoch is not in it; a reconnect or FILE_SEARCH_CACHE_TTL_MS only
          // makes the held list stale, so it still shows while it is read again. Read once, so a
          // cutover between the two calls below cannot put one attempt in two scopes.
          const inventoryScope: RequestScope = [client, worktreeId, client.getGeneration?.() ?? 0]
          const held = inventory.read(inventoryScope, WHOLE_WORKSPACE)
          const heldAt = inventoryReadAtRef.current
          if (held) {
            applyPaths(rankSuggestions(held, normalizedQuery, limit), heldAt ?? 0)
            if (isFresh(heldAt)) {
              return
            }
          }
          // Why: older hosts expose only the full inventory RPC; queries that
          // overlap its slow local/SSH read must share one request.
          const loaded = await inventory.load(inventoryScope, WHOLE_WORKSPACE, async () => {
            const response = await nativeChatFileInventoryRead.request(client, {
              worktree: `id:${worktreeId}`
            })
            const accepted = nativeChatFileInventoryRead.interpret(response)
            return accepted.accepted ? accepted.value : null
          })
          if (!loaded) {
            unanswered = 'the host refused its file list'
            return
          }
          if (inventory.commit(loaded.lease, loaded.value) !== 'committed') {
            unanswered = 'the connection changed under the file list read'
            return
          }
          inventoryReadAtRef.current = Date.now()
          applyPaths(rankSuggestions(loaded.value, normalizedQuery, limit), inventoryReadAtRef.current)
        }
        void (async () => {
          if (searchSupportedRef.current === false) {
            await loadLegacyPaths()
            return
          }
          const response = await nativeChatFileSearchRead.request(client, {
            worktree: `id:${worktreeId}`,
            query: normalizedQuery,
            limit
          })
          const accepted = nativeChatFileSearchRead.interpret(response)
          if (accepted.accepted) {
            searchSupportedRef.current = true
            applyPaths(accepted.value, Date.now())
            return
          }
          // Why the raw refusal: `method_not_found` is what makes the composer fall back to the
          // full inventory, and no acceptance policy carries a code.
          if (!response.ok && response.error.code === 'method_not_found') {
            searchSupportedRef.current = false
            await loadLegacyPaths()
            return
          }
          unanswered = response.ok ? 'the reply carried no result' : `refused: ${response.error.message}`
        })()
          .catch((error: unknown) => {
            unanswered = error instanceof Error ? error.message || 'no reason given' : String(error)
          })
          .finally(() => {
            // Why: a rejected or unsupported search must not read as "still searching".
            if (sequenceRef.current === sequence) {
              setNativeChatFileSearchPending(false)
              // Nor as "nothing matched": say it failed, and why, once.
              if (!answered) {
                console.warn(`[file-search] a path search was not answered: ${unanswered}`)
                setNativeChatFileSearchFailed(true)
              }
            }
          })
      }, FILE_SEARCH_DEBOUNCE_MS)
    },
    [client, inventory, limit, worktreeId]
  )

  return {
    nativeChatFilePaths,
    nativeChatFileSearchPending,
    nativeChatFileSearchFailed,
    loadNativeChatFiles
  }
}
