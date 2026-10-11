// What a tool sheet reads a desktop file with: the Read sheet's "Load full
// file" (parity gap G19). The session screen provides it, because that is the
// component that knows the host, the worktree and the connection; the sheets
// sit several components below it. Without a provider there is no button.
//
// The read is the created-file read-back's (mobile-native-chat-created-file-read.ts):
// `files.resolveTerminalPath` with no chat provenance, then `files.read`. So
// only a file inside this worktree can be loaded, which is the grant rule the
// phone already keeps for reads it starts itself; a path outside it comes back
// refused with that reason, and the host's 512 KiB cap is reported as a cut.

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { readCreatedFile, type CreatedFileReadOutcome } from './mobile-native-chat-created-file-read'

export type NativeChatFileReader = {
  /** The host is reachable now; a read asked for while it is not is not sent. */
  connected: boolean
  read: (path: string) => Promise<CreatedFileReadOutcome>
}

const NativeChatFileReadContext = createContext<NativeChatFileReader | null>(null)

export function NativeChatFileReadProvider({
  value,
  children
}: {
  value: NativeChatFileReader | null
  children: ReactNode
}) {
  return <NativeChatFileReadContext.Provider value={value}>{children}</NativeChatFileReadContext.Provider>
}

export function useNativeChatFileReader(): NativeChatFileReader | null {
  return useContext(NativeChatFileReadContext)
}

/** The reader for one host and worktree, or null with no client to send on. */
export function useNativeChatFileReaderFor(client: RpcClient | null, worktreeId: string, connected: boolean): NativeChatFileReader | null {
  return useMemo(
    () => (client ? { connected, read: (path: string) => readCreatedFile({ client, worktreeId, path }) } : null),
    [client, worktreeId, connected]
  )
}
