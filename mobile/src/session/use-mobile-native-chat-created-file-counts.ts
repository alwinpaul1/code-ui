import { useLayoutEffect, useState } from 'react'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import type { RpcClient } from '../transport/rpc-client'
import {
  createCreatedFileCountStore,
  type CreatedFileCountStore
} from './mobile-native-chat-created-file-count-store'

/**
 * The session's created-file read-back store, kept for as long as the session
 * screen is, and told which host, worktree and connection it reads through.
 * A new connection is what retries a read that failed, once the transcript
 * that connection brings is in.
 */
export function useMobileNativeChatCreatedFileCounts(options: {
  client: RpcClient | null
  hostId: string
  worktreeId: string
}): CreatedFileCountStore {
  const { client, hostId, worktreeId } = options
  const [store] = useState(createCreatedFileCountStore)
  const lastConnectedAt = useLastConnectedAt(hostId)
  useLayoutEffect(() => {
    store.configure({ client, hostId, worktreeId, lastConnectedAt })
  }, [store, client, hostId, worktreeId, lastConnectedAt])
  return store
}
