import type { HostProfile } from './types'

/**
 * The host profile carries whether the direct endpoint answers, so the next
 * launch can skip the direct head start (dead endpoint) or grant it again.
 * Returns the profile to save, or null when nothing changed.
 */
export function withDirectVerdict(
  host: HostProfile,
  reachable: boolean,
  now: number
): HostProfile | null {
  const current = host.directUnreachableSince ?? null
  if (reachable ? current === null : current !== null) {
    return null
  }
  const next: HostProfile = { ...host }
  if (reachable) {
    delete next.directUnreachableSince
  } else {
    next.directUnreachableSince = now
  }
  return next
}
