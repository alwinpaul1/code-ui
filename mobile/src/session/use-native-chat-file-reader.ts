import { useMemo } from 'react'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { readCreatedFile } from './mobile-native-chat-created-file-read'
import type { NativeChatFileReader } from './native-chat-file-read-context'

/** The Read sheet's file reader for one host and worktree, or null with no
 *  client to send on (native-chat-file-read-context.tsx). */
export function useNativeChatFileReaderFor(
  client: RpcClient | null,
  hostId: string,
  worktreeId: string,
  connState: ConnectionState
): NativeChatFileReader | null {
  const connected = connState === 'connected'
  const connectedAt = useLastConnectedAt(hostId)
  return useMemo(
    () => (client ? { connected, connectedAt, read: (path: string) => readCreatedFile({ client, worktreeId, path }) } : null),
    [client, worktreeId, connected, connectedAt]
  )
}
