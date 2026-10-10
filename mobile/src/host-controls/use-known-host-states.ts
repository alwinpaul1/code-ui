import { useCallback, useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { MacHostAction } from './mac-host-commands'
import {
  expectedHostStateForRender,
  expectedStateAfterAction,
  expireHostExpectations,
  knownAfterProbe,
  nextHostExpectationExpiry,
  type KnownHostState
} from './mac-host-expected-state'
import type { MacHostState } from './mac-host-state'

/** Which connection an answer belongs to: a new connect is a new value. */
export function connectedAtOf(client: RpcClient | undefined): number | null {
  return typeof client?.getLastConnectedAt === 'function' ? client.getLastConnectedAt() : null
}

/**
 * What the phone knows about each host between opens of its menu: the last answer,
 * and after an action that finished OK, the state that action left behind, which the
 * next open draws at once instead of "Checking" (mac-host-expected-state.ts).
 *
 * Per host, and tied to one connection: a host whose link drops forgets it, and so
 * does a host that reconnected without the drop ever being rendered (the connection
 * time is compared too). Each expectation stops being drawn when its window runs out.
 */
export function useKnownHostStates(clients: { hostId: string; client: RpcClient; state: ConnectionState }[]) {
  const [known, setKnown] = useState<Readonly<Record<string, KnownHostState>>>({})

  useEffect(() => {
    const gone = Object.keys(known).filter(
      (hostId) => clients.find((entry) => entry.hostId === hostId)?.state !== 'connected'
    )
    if (gone.length > 0) {
      setKnown((previous) => {
        const next = { ...previous }
        gone.forEach((hostId) => delete next[hostId])
        return next
      })
    }
  }, [clients, known])

  useEffect(() => {
    const expiry = nextHostExpectationExpiry(known)
    if (expiry === null) {
      return
    }
    let timer: ReturnType<typeof setTimeout>
    // Re-armed when it lands before the deadline (an early timer, a clock stepped
    // back): nothing expires then, `known` does not change, and this effect would
    // not run again to schedule another.
    const arm = (at: number) => {
      timer = setTimeout(() => {
        const now = Date.now()
        if (now < at) {
          arm(at)
          return
        }
        setKnown((previous) => expireHostExpectations(previous, now))
      }, Math.max(0, at - Date.now()))
    }
    arm(expiry)
    return () => clearTimeout(timer)
  }, [known])

  /** A probe answered for `hostId` on the connection that was up when it started. */
  const recordProbe = useCallback((hostId: string, probed: MacHostState, connectedAt: number | null) => {
    setKnown((previous) => ({
      ...previous,
      [hostId]: knownAfterProbe({ known: previous[hostId], probed, connectedAt, now: Date.now() })
    }))
  }, [])

  /** An action finished OK on `hostId`. Never called for one that did not. */
  const recordAction = useCallback(
    (hostId: string, action: MacHostAction, platform: NodeJS.Platform | null | undefined, client?: RpcClient) => {
      const connectedAt = connectedAtOf(client)
      setKnown((previous) => ({
        ...previous,
        [hostId]: expectedStateAfterAction({ known: previous[hostId], action, platform, connectedAt, now: Date.now() })
      }))
    },
    []
  )

  /** An action started on `hostId`: stop drawing what the last one left behind, so the
   *  menu says "Checking" (a disabled row) until this one finishes, and no row can
   *  start a second run over it. What is known stays, as the base this one builds on. */
  const actionStarted = useCallback((hostId: string) => {
    setKnown((previous) => {
      const entry = previous[hostId]
      return entry && entry.drawUntil !== null ? { ...previous, [hostId]: { ...entry, drawUntil: null } } : previous
    })
  }, [])

  /** An action failed, did not finish or threw on `hostId`: it may have half-run, so
   *  nothing known about the host is trusted any more and the next open asks. */
  const actionFailed = useCallback((hostId: string) => {
    setKnown((previous) => {
      if (!(hostId in previous)) {
        return previous
      }
      const next = { ...previous }
      delete next[hostId]
      return next
    })
  }, [])

  /** The state to draw at once for `hostId` on `client`'s connection, or null. */
  const expectedFor = (hostId: string | null, client: RpcClient | undefined): MacHostState | null =>
    hostId ? expectedHostStateForRender(known[hostId], connectedAtOf(client)) : null

  /** Whether the last answer from `hostId` said it has Modern Standby, drawn or not.
   *  Only words a progress line (windowsHostActionProgress); the script asks again. */
  const sleepsWithDisplayFor = useCallback(
    (hostId: string): boolean => known[hostId]?.state.sleepsWithDisplay === true,
    [known]
  )

  return { recordProbe, recordAction, actionStarted, actionFailed, expectedFor, sleepsWithDisplayFor }
}
