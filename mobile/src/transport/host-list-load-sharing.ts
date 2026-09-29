import type { HostCatalogEntry, HostProfile } from './types'

export type HostListSnapshot = {
  catalog: HostCatalogEntry[]
  profiles: HostProfile[]
}

// Why: concurrent callers share a slow Keychain pass; durable writes invalidate
// it so later loads cannot receive stale snapshots (#8791).
let inflight: Promise<HostListSnapshot> | null = null
let revision = 0
// Why apart from `revision`: that one moves on every durable write, including the
// last-connected stamp written on each connect. This one moves only when a host
// is added or removed (the SET of host ids changes), which is the only change
// that can turn "no hosts" into "some" or back. Rewrites of an existing host's
// row do not move it, so a network change never blanks the home list.
let membershipRevision = 0

export function getHostMembershipRevision(): number {
  return membershipRevision
}

export function noteHostMembershipChange(): void {
  membershipRevision += 1
}

export function noteHostMembershipIf(changed: boolean): void {
  if (changed) {
    noteHostMembershipChange()
  }
}

export function getHostListLoadRevision(): number {
  return revision
}

export function shareHostListLoad(
  load: () => Promise<HostListSnapshot>
): Promise<HostListSnapshot> {
  if (inflight) {
    return inflight
  }
  const started = load().finally(() => {
    // Why: a dropped pass can settle after its replacement started; only retire
    // the entry still on offer, or the replacement is silently discarded.
    if (inflight === started) {
      inflight = null
    }
  })
  inflight = started
  return started
}

/** Call after every durable host write so no later read is served a pre-write pass. */
export function dropSharedHostListLoad(): void {
  revision += 1
  inflight = null
}

// Why ids only: routine saves of an existing host (the direct-route memory on each
// network change, the supervisor's preferred endpoint, a relay upgrade, a same-id
// re-pair) rewrite a row without changing which desktops exist.
export function sameHostIdSet(
  before: readonly { id: string }[],
  after: readonly { id: string }[]
): boolean {
  if (before.length !== after.length) {
    return false
  }
  const ids = new Set(before.map(({ id }) => id))
  return after.every(({ id }) => ids.has(id))
}
