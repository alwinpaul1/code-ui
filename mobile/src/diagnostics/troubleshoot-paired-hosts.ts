import type { HostCatalogEntry, HostProfile } from '../transport/types'
import type { TroubleshootCheck } from './troubleshoot-host-check'

const PAIRED_HOSTS = 'Paired hosts'

/**
 * The "Paired hosts" row, counted from the catalog.
 *
 * Why the catalog and not loadHosts(): loadHosts() drops a host whose Keychain read throws, so a
 * phone whose only desktop was Keychain-locked failed this row with "None — scan a QR to pair"
 * (review, 2026-09-30). Only an empty catalog means nothing is paired.
 */
export function troubleshootPairedHostsCheck(
  catalog: readonly Pick<HostCatalogEntry, 'credentialStatus'>[]
): TroubleshootCheck {
  if (catalog.length === 0) {
    return { label: PAIRED_HOSTS, status: 'fail', detail: 'None — scan a QR to pair' }
  }
  const unavailable = catalog.filter(
    (entry) => entry.credentialStatus === 'temporarily-unavailable'
  ).length
  const missing = catalog.filter((entry) => entry.credentialStatus === 'missing').length
  const paired = `${catalog.length} paired`
  if (unavailable === 0 && missing === 0) {
    return { label: PAIRED_HOSTS, status: 'pass', detail: paired }
  }
  const parts = [paired]
  if (unavailable > 0) {
    parts.push(`${unavailable} can't be read right now`)
  }
  if (missing > 0) {
    parts.push(`${missing} ${missing === 1 ? 'needs' : 'need'} pairing again`)
  }
  return { label: PAIRED_HOSTS, status: 'warn', detail: parts.join(', ') }
}

/** The host list read itself rejected: nothing is known about what is paired. */
export const PAIRED_HOSTS_UNREADABLE_CHECK: TroubleshootCheck = {
  label: PAIRED_HOSTS,
  status: 'warn',
  detail: 'Could not read host data'
}

export type TroubleshootHostTarget =
  | { kind: 'probe'; host: HostProfile }
  | { kind: 'check'; check: TroubleshootCheck }

/**
 * A listed desktop the reachability rows can probe, or the row that says why it was not tested.
 * An unreadable desktop used to vanish from the rows without a word; probing its endpoint anyway
 * would pass a desktop the phone cannot connect to, so it is named and left untested.
 */
export function troubleshootHostTarget(entry: HostCatalogEntry): TroubleshootHostTarget {
  if (entry.credentialStatus === 'ready' && entry.profile !== null) {
    return { kind: 'probe', host: entry.profile }
  }
  if (entry.credentialStatus === 'missing') {
    return {
      kind: 'check',
      check: {
        label: entry.name,
        status: 'fail',
        detail: 'Not tested: it needs pairing again. Scan its code from the home screen.'
      }
    }
  }
  return {
    kind: 'check',
    check: {
      label: entry.name,
      status: 'warn',
      detail: "Not tested: it can't be read right now. Run again in a moment."
    }
  }
}
