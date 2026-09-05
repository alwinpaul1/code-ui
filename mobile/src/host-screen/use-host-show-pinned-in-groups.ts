import { useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'

type SettingsGetResult = {
  settings?: { showPinnedWorktreesInGroups?: boolean }
}

/**
 * Desktop's `showPinnedWorktreesInGroups` policy for the workspace list.
 *
 * Why (#15494): desktop hides pinned workspaces from their natural group by
 * default; mobile duplicated them into Pinned AND the group. Missing or false
 * (including hosts too old to send the field) means Pinned-only.
 */
export function useHostShowPinnedInGroups(
  client: Pick<RpcClient, 'sendRequest'> | null,
  connState: ConnectionState
): boolean {
  const [showPinnedInGroups, setShowPinnedInGroups] = useState(false)
  useEffect(() => {
    if (!client || connState !== 'connected') {
      return
    }
    let disposed = false
    client
      .sendRequest('settings.get')
      .then((response) => {
        if (disposed || !response.ok) {
          return
        }
        const settings = (response.result as SettingsGetResult | undefined)?.settings
        setShowPinnedInGroups(settings?.showPinnedWorktreesInGroups === true)
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [client, connState])
  return showPinnedInGroups
}
