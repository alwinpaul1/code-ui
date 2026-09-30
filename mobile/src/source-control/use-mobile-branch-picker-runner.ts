import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { RuntimeGitLocalBranches } from '../../../src/shared/runtime-types'
import type { RpcClient } from '../transport/rpc-client'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'

type SendGitRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

/** When the host last connected; a client without the accessor (a test fake) never moves it. */
function lastConnectedAt(client: RpcClient | null): number | null {
  return client && typeof client.getLastConnectedAt === 'function'
    ? client.getLastConnectedAt()
    : null
}

/**
 * The Switch Branch picker's read of `git.localBranches`.
 *
 * The list is null while it is on its way, and it STAYS null when the read fails:
 * `localBranchesFailed` is what tells the two apart. A failure used to store an empty list with no
 * message and no log line, and the picker drew the same row-less sheet for a slow relay, a failed
 * read and a repo with no branches.
 *
 * A failed read is made again once per NEW connection (shouldRefetchAfterReconnect), never while
 * the host stays down. The connection is read off the client, as the file search does: this hook
 * has no host subscription of its own, and the screen re-renders on every connection change.
 */
export function useMobileBranchPickerRunner(params: {
  client: RpcClient | null
  sendGitRequest: SendGitRequest
  mountedRef: MutableRefObject<boolean>
  setShowActionSheet: (next: boolean) => void
  setLocalBranches: (next: RuntimeGitLocalBranches | null) => void
  setShowBranchPicker: (next: boolean) => void
}) {
  const {
    client,
    sendGitRequest,
    mountedRef,
    setShowActionSheet,
    setLocalBranches,
    setShowBranchPicker
  } = params
  const [localBranchesFailed, setLocalBranchesFailed] = useState(false)
  // Only the latest read may answer: a slow first read must not land over a retry's list.
  const requestRef = useRef(0)
  const ledgerRef = useRef(createStaleAfterReconnectLedger())

  const retryLocalBranches = useCallback(() => {
    const request = ++requestRef.current
    setLocalBranches(null)
    setLocalBranchesFailed(false)
    const fail = (why: string): void => {
      if (!mountedRef.current || request !== requestRef.current) {
        return
      }
      console.warn(
        `[source-control] branches not loaded for Switch Branch: ${why || 'no reason given'}`
      )
      setLocalBranchesFailed(true)
    }
    if (!client) {
      fail('not connected')
      return
    }
    void sendGitRequest<RuntimeGitLocalBranches>('git.localBranches').then(
      (result) => {
        if (mountedRef.current && request === requestRef.current) {
          setLocalBranches(result)
        }
      },
      (error: unknown) => fail(error instanceof Error ? error.message : String(error))
    )
  }, [client, mountedRef, sendGitRequest, setLocalBranches])

  const openBranchPicker = useCallback(() => {
    setShowActionSheet(false)
    setShowBranchPicker(true)
    retryLocalBranches()
  }, [retryLocalBranches, setShowActionSheet, setShowBranchPicker])

  const connectedAt = lastConnectedAt(client)
  useEffect(() => {
    const status = localBranchesFailed ? 'error' : 'ready'
    if (shouldRefetchAfterReconnect(ledgerRef.current, 'local-branches', status, connectedAt)) {
      retryLocalBranches()
    }
  }, [connectedAt, localBranchesFailed, retryLocalBranches])

  return { openBranchPicker, retryLocalBranches, localBranchesFailed }
}
