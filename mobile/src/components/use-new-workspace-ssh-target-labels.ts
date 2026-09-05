import { useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import type { SshTargetLabels } from './new-workspace-project-targets'

/** Resolves SSH target ids to their user-facing labels for the Run on picker.
 *  Best effort: a host without ssh.listTargetSummaries leaves the map empty and
 *  the picker falls back to the id, as before (Orca issue #16114). */
export function useNewWorkspaceSshTargetLabels(
  client: RpcClient | null,
  enabled: boolean
): SshTargetLabels {
  const [labels, setLabels] = useState<SshTargetLabels>(() => new Map())
  useEffect(() => {
    if (!client || !enabled) {
      return
    }
    let cancelled = false
    void client.sendRequest('ssh.listTargetSummaries').then(
      (response) => {
        if (cancelled || !response.ok) {
          return
        }
        const targets = ((response as RpcSuccess).result as { targets?: unknown } | null)?.targets
        if (!Array.isArray(targets)) {
          return
        }
        const next = new Map<string, string>()
        for (const target of targets) {
          const row = target as { id?: unknown; label?: unknown }
          if (typeof row.id === 'string' && typeof row.label === 'string' && row.label.trim()) {
            next.set(row.id, row.label.trim())
          }
        }
        setLabels(next)
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [client, enabled])
  return labels
}
