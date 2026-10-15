import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { MacHostAction } from './mac-host-commands'
import {
  cachedHostStateForRender,
  expectedHostStateForRender,
  expectedStateAfterAction,
  expireHostExpectations,
  hostStateToDraw,
  knownAfterProbe,
  nextHostExpectationExpiry,
  type KnownHostState
} from './mac-host-expected-state'
import type { MacHostState } from './mac-host-state'
import {
  forgetRememberedHostState,
  loadRememberedHostState,
  mergeRememberedHalves,
  rememberHostStateHalves,
  rememberableHalves,
  withRememberedHalves,
  type RememberedHostState
} from './remembered-host-state-store'

/** Which connection an answer belongs to: a new connect is a new value. */
export function connectedAtOf(client: RpcClient | undefined): number | null {
  return typeof client?.getLastConnectedAt === 'function' ? client.getLastConnectedAt() : null
}

/**
 * What the phone knows about each host between opens of its menu: the last answer,
 * and after an action that finished OK, the state that action left behind. The next
 * open draws either at once, while it asks again (mac-host-expected-state.ts).
 *
 * Per host, and tied to one connection: a host whose link drops forgets it, and so
 * does a host that reconnected without the drop ever being rendered (the connection
 * time is compared too). Each expectation stops being drawn when its window runs out.
 *
 * Apart from that, the display and the sound the host last named are kept on the
 * phone across connections and restarts (remembered-host-state-store.ts), and fill any
 * half the menu would otherwise draw as unknown, so the first open on a new connection
 * offers one row of each pair, not both (the user, 2026-10-15). The lock is never kept.
 */
export function useKnownHostStates(clients: { hostId: string; client: RpcClient; state: ConnectionState }[]) {
  const [known, setKnown] = useState<Readonly<Record<string, KnownHostState>>>({})
  const [remembered, setRemembered] = useState<Readonly<Record<string, RememberedHostState>>>({})
  // The hosts whose kept state has been asked for on this run, once each, and which
  // request is theirs, so an answer for a host removed meanwhile is dropped.
  const loadRequestsRef = useRef(new Map<string, symbol>())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const present = new Set(clients.map((entry) => entry.hostId))
    // A host no longer paired: forget it here too, so a re-pair reads the store again
    // (which its removal cleared, host-removal-lifecycle.ts).
    for (const hostId of loadRequestsRef.current.keys()) {
      if (!present.has(hostId)) {
        loadRequestsRef.current.delete(hostId)
      }
    }
    setRemembered((previous) => {
      const gone = Object.keys(previous).filter((hostId) => !present.has(hostId))
      if (gone.length === 0) {
        return previous
      }
      const next = { ...previous }
      gone.forEach((hostId) => delete next[hostId])
      return next
    })
    for (const hostId of present) {
      if (loadRequestsRef.current.has(hostId)) {
        continue
      }
      const request = Symbol(hostId)
      loadRequestsRef.current.set(hostId, request)
      // Not dropped when `clients` changes again: the request is made once per host,
      // so an answer thrown away here would never be asked for again. Only an unmount,
      // or the host leaving and the request with it, throws it away.
      void loadRememberedHostState(hostId).then((kept) => {
        if (!mountedRef.current || loadRequestsRef.current.get(hostId) !== request || !kept) {
          return
        }
        // What this run already learnt is newer than the store, half by half.
        setRemembered((previous) => ({
          ...previous,
          [hostId]: mergeRememberedHalves(kept, previous[hostId] ?? {})
        }))
      })
    }
  }, [clients])

  /** Keeps the display and mute halves `state` names, in memory and in the store. A
   *  half it could not say leaves what was kept. */
  const remember = useCallback((hostId: string, state: MacHostState) => {
    const halves = rememberableHalves(state)
    if (!halves) {
      return
    }
    setRemembered((previous) => ({ ...previous, [hostId]: mergeRememberedHalves(previous[hostId], halves) }))
    void rememberHostStateHalves(hostId, halves)
  }, [])

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
  const recordProbe = useCallback(
    (hostId: string, probed: MacHostState, connectedAt: number | null) => {
      setKnown((previous) => ({
        ...previous,
        [hostId]: knownAfterProbe({ known: previous[hostId], probed, connectedAt, now: Date.now() })
      }))
      remember(hostId, probed)
    },
    [remember]
  )

  /** An action finished OK on `hostId`. Never called for one that did not. */
  const recordAction = useCallback(
    (hostId: string, action: MacHostAction, platform: NodeJS.Platform | null | undefined, client?: RpcClient) => {
      const connectedAt = connectedAtOf(client)
      const now = Date.now()
      setKnown((previous) => ({
        ...previous,
        [hostId]: expectedStateAfterAction({ known: previous[hostId], action, platform, connectedAt, now })
      }))
      // Only the half this action set: from nothing known, the expectation names
      // just that one.
      remember(hostId, expectedStateAfterAction({ known: undefined, action, platform, connectedAt, now }).state)
    },
    [remember]
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
   *  nothing known about the host is trusted any more and the next open asks. What
   *  was kept across connections goes too, in the store as well: a Mute that half-ran
   *  leaves a remembered "unmuted" that may be false, and the next answer keeps it again. */
  const actionFailed = useCallback((hostId: string) => {
    setRemembered((previous) => {
      if (!(hostId in previous)) {
        return previous
      }
      const next = { ...previous }
      delete next[hostId]
      return next
    })
    void forgetRememberedHostState(hostId)
    // A read of the store still out would bring the old value back when it lands.
    if (loadRequestsRef.current.has(hostId)) {
      loadRequestsRef.current.set(hostId, Symbol(hostId))
    }
    setKnown((previous) => {
      if (!(hostId in previous)) {
        return previous
      }
      const next = { ...previous }
      delete next[hostId]
      return next
    })
  }, [])

  const connectedAtFor = (hostId: string) =>
    connectedAtOf(clients.find((entry) => entry.hostId === hostId)?.client)

  /** The state to draw at once for `hostId` on its current connection, or null. */
  const expectedFor = (hostId: string | null): MacHostState | null =>
    hostId ? expectedHostStateForRender(known[hostId], connectedAtFor(hostId)) : null

  /** What was last learnt about `hostId` on its current connection, to draw while this
   *  open's probe is out, or null (cachedHostStateForRender). */
  const cachedFor = (hostId: string | null): MacHostState | null =>
    hostId ? cachedHostStateForRender(known[hostId], connectedAtFor(hostId)) : null

  /** What the open menu draws for `hostId`, given this open's own answer, if any
   *  (hostStateToDraw). `settling` holds the hosts whose action runs or settles. */
  const drawFor = (hostId: string | null, probed: MacHostState | null, settling: ReadonlySet<string>) => {
    const drawn = hostStateToDraw(expectedFor(hostId), probed, cachedFor(hostId), hostId !== null && settling.has(hostId))
    return drawn === 'checking' || hostId === null ? drawn : withRememberedHalves(drawn, remembered[hostId])
  }

  return { recordProbe, recordAction, actionStarted, actionFailed, drawFor }
}
