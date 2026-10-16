import { createContext, useContext, useMemo } from 'react'
import { verdictDisplayLabel, type ConnectionVerdict } from '../transport/connection-health'
import type { ForceReconnect } from '../transport/rpc-client-context-contract'

/**
 * What a loading screen says in place of "Loading session…" once the connection it waits on is
 * known to be in trouble (2026-10-16: Clawd danced over "Loading session…" for as long as the
 * desktop stayed out of reach, so a Mac that was asleep looked like a slow load).
 *
 * "In trouble" is `classifyConnection`'s escalation, the same one the session header uses for its
 * tap to retry: `warning` (three failed dials, or the relay's own word), `unreachable`, and
 * `auth-failed`. A `normal` verdict ("Connecting…") keeps the loading screen: a phone that is
 * still dialling is still loading.
 */
export type LoadingConnectionTrouble = {
  /** The verdict's own label, as the header and the host list word it ("Can't reach desktop"). */
  label: string
  /** Where to look. The relay's verdicts carry their own; the rest name the desktop and Orca. */
  detail: string | null
  /** Whether re-dialling can help. A refused pairing cannot be fixed by dialling again. */
  retryable: boolean
}

/** The trouble a loading screen should show for a verdict, or null to keep loading. `hostName` is
 *  the paired desktop's name, or null when the host store has not said it. */
export function loadingConnectionTrouble(
  verdict: ConnectionVerdict,
  hostName: string | null
): LoadingConnectionTrouble | null {
  if (verdict.kind === 'normal') {
    return null
  }
  if (verdict.kind === 'auth-failed') {
    return { label: verdict.label, detail: null, retryable: false }
  }
  return {
    label: verdictDisplayLabel(verdict),
    detail: verdict.detail ?? unreachableDetail(hostName),
    retryable: true
  }
}

/** The Claude app's `ccr_devices_asleep_lead` ("%1$s isn't reachable right now. It may be asleep or
 *  offline. Wake it and it should reconnect on its own."), said of what Code UI dials: the user's
 *  desktop running Orca. The phone keeps re-dialling at its back-off, so "on its own" holds. */
export function unreachableDetail(hostName: string | null): string {
  const name = hostName?.trim() || 'Your desktop'
  return `${name} isn’t reachable right now. Check it’s awake and Orca is running; this screen reconnects on its own.`
}

/** A loading screen's trouble, and the re-dial its Retry runs (null where nothing here can dial:
 *  the web page, whose shell owns the connection, or a pairing that dialling cannot fix). */
export type LoadingConnectionTroubleState = {
  trouble: LoadingConnectionTrouble
  onRetry: (() => void) | null
}

/** Handed down by the session screen, which owns the connection's verdict, to the loading screens
 *  under it, which draw it in place of their loading label. The host check (HostProtocolGate) has
 *  none to hand: it holds the routes only while a connected host answers status.get. */
export const LoadingConnectionTroubleContext = createContext<LoadingConnectionTroubleState | null>(null)

export function useLoadingConnectionTroubleContext(): LoadingConnectionTroubleState | null {
  return useContext(LoadingConnectionTroubleContext)
}

/** The state a loading screen is handed for a verdict, one object while the words stay the same
 *  (so the screens under it do not redraw on every reconnect attempt), null while there is no
 *  trouble. Retry re-dials `hostId`; a failed re-dial is the next verdict's to say. */
export function useLoadingConnectionTroubleState(
  verdict: ConnectionVerdict,
  hostName: string | null,
  hostId: string | undefined,
  forceReconnect: ForceReconnect
): LoadingConnectionTroubleState | null {
  const now = hostId ? loadingConnectionTrouble(verdict, hostName) : null
  const label = now?.label ?? null
  const detail = now?.detail ?? null
  const retryable = now?.retryable ?? false
  return useMemo(() => {
    if (label === null || !hostId) {
      return null
    }
    return {
      trouble: { label, detail, retryable },
      onRetry: retryable && forceReconnect !== null ? () => void forceReconnect(hostId).catch(() => {}) : null
    }
  }, [label, detail, retryable, hostId, forceReconnect])
}
