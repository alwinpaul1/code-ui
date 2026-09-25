import { useEffect, useMemo, useState } from 'react'
import type { CatalogModel } from '../../../src/shared/agent-session-option-catalog-types'
import type { runRpcOperation } from '../transport/rpc-operation'
import {
  discoverClaudeModels,
  discoveredClaudeCatalogModels,
  hydrateDiscoveredClaudeModels,
  peekDiscoveredClaudeModels,
  type DiscoveredClaudeModel
} from './claude-model-discovery'

/**
 * The host's own list of Claude models for the sheet, or null to keep the seed
 * (fail open: the seed is what every Claude sheet showed before this).
 *
 * `lastConnectedAt` is in the effect's deps so a discovery that failed because
 * the relay was still dialling is asked once more when the host connects, and
 * only then (the repo's "nothing stays stale once the relay connects"). It
 * cannot spin: a failure changes none of the deps, and a success is cached, so
 * the next connection answers from memory without a request.
 */
export function useClaudeModelDiscovery(args: {
  client: Parameters<typeof runRpcOperation>[0] | null
  hostId: string
  worktreeId: string
  enabled: boolean
  lastConnectedAt: number | null
}): CatalogModel[] | null {
  const { client, hostId, worktreeId, enabled, lastConnectedAt } = args
  const scope = JSON.stringify([hostId, worktreeId])
  const [found, setFound] = useState<{ scope: string; models: DiscoveredClaudeModel[] } | null>(null)
  useEffect(() => {
    if (!enabled || !client || !worktreeId) {
      return
    }
    let active = true
    const known = peekDiscoveredClaudeModels(hostId, worktreeId)
    if (known) {
      setFound({ scope, models: known })
    }
    void hydrateDiscoveredClaudeModels(hostId, worktreeId).then(() => {
      const stored = peekDiscoveredClaudeModels(hostId, worktreeId)
      if (active && stored) {
        setFound((current) => (current?.scope === scope ? current : { scope, models: stored }))
      }
    })
    void discoverClaudeModels({ client, hostId, worktreeId }).then((models) => {
      if (active && models) {
        setFound({ scope, models })
      }
    })
    return () => {
      active = false
    }
  }, [client, enabled, hostId, lastConnectedAt, scope, worktreeId])
  return useMemo(
    () => (enabled && found?.scope === scope ? discoveredClaudeCatalogModels(found.models) : null),
    [enabled, found, scope]
  )
}
