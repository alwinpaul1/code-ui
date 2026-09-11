import type { HostProfile } from './types'

/**
 * The host profile carries whether the direct endpoint answers, so the next
 * launch can skip the direct head start (dead endpoint) or grant it again.
 * Returns the profile to save, or null when nothing changed.
 */
export function withDirectVerdict(
  host: HostProfile,
  reachable: boolean,
  now: number,
  network: string | null = null
): HostProfile | null {
  const current = host.directUnreachableSince ?? null
  const sameNetwork = (host.directUnreachableNetwork ?? null) === network
  if (reachable ? current === null : current !== null && sameNetwork) {
    return null
  }
  const next: HostProfile = { ...host }
  if (reachable) {
    delete next.directUnreachableSince
    delete next.directUnreachableNetwork
  } else {
    next.directUnreachableSince = now
    if (network) {
      next.directUnreachableNetwork = network
    } else {
      delete next.directUnreachableNetwork
    }
  }
  return next
}

/** How long a direct-dead verdict stands before one dial re-tests it. Reviewed
 *  2026-09-11: without an expiry, a desktop that restarted Orca on the home
 *  Wi-Fi left the phone on the billed relay for the rest of the process. */
export const DIRECT_VERDICT_TTL_MS = 10 * 60_000

/** True when direct was proven dead on the network the phone is on right now,
 *  recently enough that re-dialling would only repeat the proof. */
export function directDeadOnNetwork(
  host: HostProfile,
  network: string | null,
  now: number = Date.now()
): boolean {
  return (
    host.directUnreachableSince != null &&
    network !== null &&
    host.directUnreachableNetwork === network &&
    now - host.directUnreachableSince < DIRECT_VERDICT_TTL_MS
  )
}
