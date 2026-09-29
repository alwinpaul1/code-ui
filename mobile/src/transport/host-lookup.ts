import { loadHostCatalog } from './host-store'
import { EMPTY_HOSTS_FAILED_COPY } from './use-loaded-hosts'
import type { HostCatalogEntry, HostProfile } from './types'

/**
 * What a screen opened for one desktop may say about it.
 *
 * Why the catalog and not loadHosts(): loadHosts() drops a host whose Keychain read throws, so a
 * locked Keychain made Edit say "This host was removed from this phone." and Accounts and the host
 * screen say "Host not found" over a desktop the home screen still listed (review, 2026-09-30).
 * The catalog keeps listing it, so each state can be worded apart.
 */
export type HostLookup =
  | { kind: 'ready'; host: HostProfile }
  /** Listed, but its credential could not be read this time (locked or failing Keychain). */
  | { kind: 'unavailable'; name: string; message: string }
  /** Listed, with no credential at all: only pairing again brings it back. */
  | { kind: 'missing'; name: string; message: string }
  /** Not in the catalog: the one case where "removed" is true. */
  | { kind: 'not-listed'; message: string }
  /** The catalog read itself rejected: nothing is known about this desktop. */
  | { kind: 'failed'; message: string }

// Same wording as emptyHostsNoticeCopy in use-loaded-hosts.ts, for the one desktop a screen is on.
export const HOST_UNAVAILABLE_COPY =
  "This paired desktop can't be read right now. Reopen this screen in a moment."
export const HOST_MISSING_COPY =
  'This paired desktop needs to be paired again. Scan its code from the home screen.'
export const HOST_NOT_LISTED_COPY = 'This desktop was removed from this phone.'
export const HOST_LOOKUP_FAILED_COPY = EMPTY_HOSTS_FAILED_COPY

export function describeHostLookup(
  catalog: readonly HostCatalogEntry[],
  hostId: string
): HostLookup {
  const entry = catalog.find((candidate) => candidate.id === hostId)
  if (entry === undefined) {
    return { kind: 'not-listed', message: HOST_NOT_LISTED_COPY }
  }
  if (entry.credentialStatus === 'ready' && entry.profile !== null) {
    return { kind: 'ready', host: entry.profile }
  }
  if (entry.credentialStatus === 'missing') {
    return { kind: 'missing', name: entry.name, message: HOST_MISSING_COPY }
  }
  return { kind: 'unavailable', name: entry.name, message: HOST_UNAVAILABLE_COPY }
}

/** Reads the catalog and describes `hostId` in it. Never rejects: a failed read is `failed`, logged. */
export async function lookUpPairedHost(hostId: string): Promise<HostLookup> {
  let catalog: HostCatalogEntry[]
  try {
    catalog = await loadHostCatalog()
  } catch (error: unknown) {
    console.warn('[hosts] paired-host lookup could not read the host list', error)
    return { kind: 'failed', message: HOST_LOOKUP_FAILED_COPY }
  }
  return describeHostLookup(catalog, hostId)
}
