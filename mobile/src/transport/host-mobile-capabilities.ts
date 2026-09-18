import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useHostClient } from './client-context'
import { useLastConnectedAt } from './client-context-connection-metrics'
import {
  AGENT_SESSION_REWIND_GATE_PROBE_PARAMS,
  FILES_WRITE_GATE_PROBE_PARAMS,
  agentSessionRewindGateProbe,
  filesWriteGateProbe,
  type HostMobileCapabilityKey,
  type HostMobileCapabilityProbeSender
} from './host-mobile-capability-operations'
import { isMobileScopeRefusal } from './mobile-scope-refusal'
import type { RpcResponse } from './types'

/**
 * Which gated RPC methods THIS host lets a phone call.
 *
 * Orca's WebSocket dispatch checks every request from a mobile-scope device
 * token against a hardcoded allowlist before dispatch (the `iRa` Set in the
 * 1.4.205 bundle: `if (u.scope === 'mobile' && !iRa.has(s.method))`), and
 * refuses the rest with `{ code: 'forbidden', message: "Method '<m>' is not
 * available to mobile clients" }`. The phone ALWAYS has a mobile-scope token.
 * The RPC catalog (`src/shared/rpc-contract/`) lists every method the desktop
 * registers and says nothing about this gate, so a method can be catalogued,
 * typed, and still unreachable — which is how "Revert this hunk", "Rewind to
 * here" and the three project-config Save buttons shipped on 2026-09-18
 * against `files.write` and `agentSession.rewind`, and every tap got the
 * refusal. There is no RPC that lists the gate. The only way to learn a
 * host's answer is to call.
 *
 * So, once per connection, this module calls each gated method with
 * parameters the host must refuse without side effects (see
 * host-mobile-capability-operations.ts) and reads the refusal:
 *
 *   - the gate's own refusal            → 'forbidden'  (hide the affordance)
 *   - any OTHER refusal, or a result    → 'allowed'    (the gate let it through)
 *   - the transport failed or timed out → 'unknown'    (hide; ask again next connection)
 *
 * "Once per connection" is keyed on `lastConnectedAt`, the way
 * stale-after-reconnect.ts keys its refetch: a render never re-probes, a new
 * connection does. A host that upgrades past the gate is picked up the next
 * time the phone connects to it; a host that is down is not hammered.
 *
 * The recorded allowlist is `fixtures/orca-mobile-rpc-allowlist-1.4.205.json`;
 * orca-mobile-rpc-allowlist.test.ts is the ratchet that keeps every method the
 * phone sends either on that list or behind one of these probes.
 */
export type { HostMobileCapabilityKey } from './host-mobile-capability-operations'

export type HostMobileCapabilityVerdict = 'allowed' | 'forbidden' | 'unknown'

export type HostMobileCapabilityVerdicts = Readonly<
  Record<HostMobileCapabilityKey, HostMobileCapabilityVerdict>
>

/** A settled reply's verdict (the refusal itself is read by mobile-scope-refusal.ts).
 *  Anything the gate did not refuse got through it. */
export function readHostMobileCapabilityVerdict(
  response: RpcResponse
): Exclude<HostMobileCapabilityVerdict, 'unknown'> {
  return isMobileScopeRefusal(response) ? 'forbidden' : 'allowed'
}

async function probeOne(send: () => Promise<RpcResponse>): Promise<HostMobileCapabilityVerdict> {
  try {
    return readHostMobileCapabilityVerdict(await send())
  } catch {
    // A timeout, a dropped socket or a cutover mid-flight. Not the host's
    // answer, so not a verdict; the next connection asks again.
    return 'unknown'
  }
}

/** Runs every probe against one client. Each settles on its own: one probe
 *  failing in transport must not turn the other's clear answer into unknown. */
export async function probeHostMobileCapabilities(
  client: HostMobileCapabilityProbeSender
): Promise<HostMobileCapabilityVerdicts> {
  // Reject rather than queue while disconnected: a probe that replays after a
  // reconnect would answer for a connection other than the one it was keyed on.
  const options = { failWhenDisconnected: true }
  const [filesWrite, agentSessionRewind] = await Promise.all([
    probeOne(() => filesWriteGateProbe.request(client, FILES_WRITE_GATE_PROBE_PARAMS, options)),
    probeOne(() =>
      agentSessionRewindGateProbe.request(client, AGENT_SESSION_REWIND_GATE_PROBE_PARAMS, options)
    )
  ])
  return { 'files.write': filesWrite, 'agentSession.rewind': agentSessionRewind }
}

const NOT_PROBED: HostMobileCapabilityVerdicts = {
  'files.write': 'unknown',
  'agentSession.rewind': 'unknown'
}

type HostRecord = {
  /** The connection the verdicts belong to. */
  connectedAt: number
  verdicts: HostMobileCapabilityVerdicts
  /** True from the probe's start until it settles; the store answers unknown meanwhile. */
  inFlight: boolean
}

const records = new Map<string, HostRecord>()
const listeners = new Map<string, Set<() => void>>()

function notify(hostId: string): void {
  for (const listener of listeners.get(hostId) ?? []) {
    listener()
  }
}

function subscribe(hostId: string, listener: () => void): () => void {
  let set = listeners.get(hostId)
  if (!set) {
    set = new Set()
    listeners.set(hostId, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) {
      listeners.delete(hostId)
    }
  }
}

/** The verdicts on record for this host, or all-unknown before any probe settled. */
export function peekHostMobileCapabilities(hostId: string): HostMobileCapabilityVerdicts {
  const record = records.get(hostId)
  return record && !record.inFlight ? record.verdicts : NOT_PROBED
}

/**
 * Probes once for this host on this connection. A second call for the same
 * `connectedAt` is a no-op whether the first is still in flight or has settled;
 * a call with a NEW `connectedAt` starts over. A probe that settles after the
 * connection it was keyed on has been replaced is dropped, not stored.
 */
export function ensureHostMobileCapabilitiesProbed(
  hostId: string,
  client: HostMobileCapabilityProbeSender,
  connectedAt: number,
  probe: typeof probeHostMobileCapabilities = probeHostMobileCapabilities
): void {
  const existing = records.get(hostId)
  if (existing && existing.connectedAt === connectedAt) {
    return
  }
  records.set(hostId, { connectedAt, verdicts: NOT_PROBED, inFlight: true })
  notify(hostId)
  void probe(client).then(
    (verdicts) => {
      const current = records.get(hostId)
      if (!current || current.connectedAt !== connectedAt) {
        return
      }
      records.set(hostId, { connectedAt, verdicts, inFlight: false })
      notify(hostId)
    },
    () => {
      // probeHostMobileCapabilities settles every probe itself; this arm only
      // exists so a bug there can never leave the record in flight forever.
      const current = records.get(hostId)
      if (!current || current.connectedAt !== connectedAt) {
        return
      }
      records.set(hostId, { connectedAt, verdicts: NOT_PROBED, inFlight: false })
      notify(hostId)
    }
  )
}

export function resetHostMobileCapabilitiesForTests(): void {
  records.clear()
  listeners.clear()
}

/**
 * Whether this host lets the phone call `key`. False until the probe for the
 * current connection has answered 'allowed': a not-yet-probed host, a refused
 * probe and a probe the transport lost all read as false, because an
 * affordance that appears and then fails is the defect this exists to end.
 */
export function useHostMobileCapability(hostId: string, key: HostMobileCapabilityKey): boolean {
  const { client } = useHostClient(hostId)
  const lastConnectedAt = useLastConnectedAt(hostId)
  const subscribeToHost = useCallback(
    (listener: () => void) => subscribe(hostId, listener),
    [hostId]
  )
  // An external store, not an effect-fed state: a probe another screen
  // started can settle between this render and its subscription, and a
  // subscribe-then-read must not miss it.
  const verdicts = useSyncExternalStore(subscribeToHost, () =>
    peekHostMobileCapabilities(hostId)
  )
  useEffect(() => {
    if (!client || lastConnectedAt === null) {
      return
    }
    ensureHostMobileCapabilitiesProbed(hostId, client, lastConnectedAt)
  }, [client, hostId, lastConnectedAt])
  return verdicts[key] === 'allowed'
}
