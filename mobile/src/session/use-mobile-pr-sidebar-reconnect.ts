import { useEffect, useRef } from 'react'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'
import { isPrSidebarDetailsPlaceholder, type PrSidebarState } from './mobile-pr-sidebar-state'

/**
 * Reads the PR sidebar again once per NEW connection after a load failed.
 *
 * The chip's bootstrap and the PR segment's load both fire only for a `hidden` state, and the
 * logical client is the same object across reconnects, so a load that failed because the
 * connection dropped under it stayed on `error` for good (and a failed phase 2 on its empty
 * placeholder). The ledger (stale-after-reconnect.ts) records which connection a failure happened
 * on, and only a change of `lastConnectedAt` retries it: never once per render, never in a loop
 * while the host stays down.
 *
 * Phase 2 counts as failed only on the placeholder a failed read leaves: `details: null` is a
 * chip-only load that never asked, and a reconnect must not pull the heavy comments for it.
 */
export function useMobilePrSidebarReconnectRefetch(args: {
  identity: string | null
  state: PrSidebarState
  // `undefined` when the caller does not pass one: then nothing is retried on reconnect.
  lastConnectedAt: number | null | undefined
  reload: () => void
  refillDetails: () => void
}): void {
  const { identity, state, lastConnectedAt } = args
  const ledgerRef = useRef(createStaleAfterReconnectLedger())
  const reloadRef = useRef(args.reload)
  reloadRef.current = args.reload
  const refillDetailsRef = useRef(args.refillDetails)
  refillDetailsRef.current = args.refillDetails

  const loadStatus = state.kind === 'error' ? 'error' : 'ready'
  const detailsStatus =
    state.kind === 'ready' &&
    state.data.details != null &&
    isPrSidebarDetailsPlaceholder(state.data.details)
      ? 'error'
      : 'ready'
  const connection = lastConnectedAt ?? null

  useEffect(() => {
    if (
      identity !== null &&
      shouldRefetchAfterReconnect(ledgerRef.current, identity, loadStatus, connection)
    ) {
      reloadRef.current()
    }
  }, [connection, identity, loadStatus])

  useEffect(() => {
    if (
      identity !== null &&
      shouldRefetchAfterReconnect(
        ledgerRef.current,
        `${identity}\u0000details`,
        detailsStatus,
        connection
      )
    ) {
      refillDetailsRef.current()
    }
  }, [connection, detailsStatus, identity])
}
