import type { MobileAccessEndpoint } from './mobile-relay-host-overlay'
import type { HostProfile } from './types'

/** Every direct (non-relay) address the phone knows for a host, primary first. */
export function directEndpointUrls(host: HostProfile): string[] {
  const endpoints =
    host.endpoints?.filter(({ kind }) => kind !== 'relay').map(({ url }) => url) ?? []
  return [...new Set([host.endpoint, ...endpoints])]
}

/** Tailscale addresses are 100.64/10 literals or *.ts.net names; the rest is LAN. */
export function directEndpointKind(url: string): 'lan' | 'tailscale' {
  try {
    const hostname = new URL(url).hostname
    if (hostname.endsWith('.ts.net') || /^100\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname)) {
      return 'tailscale'
    }
  } catch {}
  return 'lan'
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return left === right
  }
}

/** The host's endpoint list with `url` present as a direct entry. Relay
 *  entries and existing direct entries are kept; the primary is added too, so
 *  a profile that never had a list gets one naming what it dials today. */
export function withDirectEndpoint(
  endpoints: readonly MobileAccessEndpoint[] | undefined,
  primary: string,
  url: string
): MobileAccessEndpoint[] {
  const next: MobileAccessEndpoint[] = [
    ...(endpoints ?? [{ id: 'direct-primary', kind: directEndpointKind(primary), url: primary }])
  ]
  for (const candidate of [primary, url]) {
    if (next.some((entry) => entry.kind !== 'relay' && sameOrigin(entry.url, candidate))) {
      continue
    }
    const kind = directEndpointKind(candidate)
    const taken = new Set(next.map((entry) => entry.id))
    let id = `direct-${kind}`
    for (let index = 2; taken.has(id); index += 1) {
      id = `direct-${kind}-${index}`
    }
    next.push({ id, kind, url: candidate })
  }
  return next
}

/**
 * Make `winner` the address the phone dials first, keeping the previous
 * primary in the list. Why: a phone paired over Tailscale that also knows the
 * LAN address should dial whichever answered last time first, and never forget
 * the other — Tailscale off at home, LAN gone on the road. Null when unchanged.
 */
export function withPreferredDirectEndpoint(host: HostProfile, winner: string): HostProfile | null {
  if (sameOrigin(host.endpoint, winner)) {
    return null
  }
  const endpoints = withDirectEndpoint(host.endpoints, host.endpoint, winner)
  const { directUnreachableSince: _stale, ...rest } = host
  return { ...rest, endpoint: winner, endpoints }
}
