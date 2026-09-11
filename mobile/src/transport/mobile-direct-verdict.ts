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

/** True when direct was proven dead on the network the phone is on right now. */
export function directDeadOnNetwork(host: HostProfile, network: string | null): boolean {
  return (
    host.directUnreachableSince != null &&
    network !== null &&
    host.directUnreachableNetwork === network
  )
}
