import { useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { worktreeCatalogRead } from '../worktree/worktree-catalog-operations'
import type { Worktree } from '../worktree/workspace-list-types'

/**
 * The host's worktree list, read once per connection for the history screen.
 *
 * It seeds the host-local scopePaths derivation and the active-worktree path for the "current
 * worktree" badge. `loaded` turns true even when the read fails, so a scoped tab proceeds with an
 * unscoped fetch instead of holding a spinner forever.
 */
export function useAgentHistoryWorktrees(
  client: RpcClient | null,
  connState: ConnectionState
): { worktrees: Worktree[]; worktreesLoaded: boolean } {
  const [worktrees, setWorktrees] = useState<Worktree[]>([])
  const [worktreesLoaded, setWorktreesLoaded] = useState(false)

  useEffect(() => {
    if (!client || connState !== 'connected') {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const worktreeReply = await worktreeCatalogRead.request(client, { limit: 10000 })
        if (cancelled) {
          return
        }
        const catalog = worktreeCatalogRead.interpret(worktreeReply)
        if (catalog.accepted) {
          // Why `?? []`: the member is salvaged, so an envelope the host answers without rows leaves it
          // absent, and the `worktrees.find` in use-mobile-agent-history-state.ts is unguarded.
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the rows stay opaque in the reader because three screens project them differently; this screen reads only `path` off a row to seed `scopePaths`, and `matrix-aivault.history-screen-worktree.ps-1` records every partition of its own family rendering a list rather than a crash.
          setWorktrees((catalog.value.worktrees ?? []) as Worktree[])
        }
      } catch {
        // Why: worktree list is best-effort context; the session scan still runs
        // (without it, scoped tabs can't narrow and fall back to the full list).
      } finally {
        if (!cancelled) {
          setWorktreesLoaded(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, connState])

  return { worktrees, worktreesLoaded }
}
