import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * A notification this device already showed because a push carried it.
 *
 * All three fields are required because the desktop's contract requires them
 * (`NotificationGetMissedSinceParams.deliveredPushes`): it matches on the triple,
 * so an entry missing one is not reportable and recording it would only evict a
 * reportable one from the bounded list.
 */
export type DeliveredPush = {
  notificationId: string
  notificationEpoch: string
  notificationSeq: number
}

/** The desktop rejects a longer array, and a rejected request loses the whole catch-up. */
export const MAX_REPORTED_DELIVERED_PUSHES = 256

const STORAGE_KEY_PREFIX = 'orca:deliveredPushes:'

function storageKey(hostId: string): string {
  return STORAGE_KEY_PREFIX + hostId
}

/**
 * Why a cache at all: the writer is a background task that may run in a headless
 * JS context, and the reader is the catch-up on the next connection. Holding the
 * list in memory keeps repeated pushes in one app lifetime from doing a
 * read-modify-write against the store for each one.
 *
 * Why a write chain: a burst of pushes would otherwise interleave their
 * read-modify-write cycles and lose all but the last. Serializing per host makes
 * each append see the previous one.
 *
 * The cache holds only a list storage handed over. A read the store refused
 * was cached as an empty list, and the next push wrote itself alone over the
 * stored one, so every push recorded before it went unreported and came back
 * as a second banner (review of 2026-09-30). A push shown while the list
 * cannot be read waits in `unsavedByHost` instead: it is reported from there,
 * and the first push whose read succeeds writes it on top of the stored list.
 */
const cacheByHost = new Map<string, DeliveredPush[]>()
const unsavedByHost = new Map<string, DeliveredPush[]>()
let writeTail: Promise<unknown> = Promise.resolve()

function isDeliveredPush(value: unknown): value is DeliveredPush {
  if (!value || typeof value !== 'object') {
    return false
  }
  const entry = value as Partial<DeliveredPush>
  return (
    typeof entry.notificationId === 'string' &&
    entry.notificationId.length > 0 &&
    typeof entry.notificationEpoch === 'string' &&
    entry.notificationEpoch.length > 0 &&
    typeof entry.notificationSeq === 'number' &&
    Number.isInteger(entry.notificationSeq)
  )
}

function parseDeliveredPushes(raw: string | null): DeliveredPush[] {
  if (raw == null) {
    return []
  }
  try {
    const value: unknown = JSON.parse(raw)
    // A corrupt or partially-written record degrades to "no pushes delivered",
    // which costs a duplicate banner rather than the whole catch-up.
    return Array.isArray(value) ? value.filter(isDeliveredPush) : []
  } catch {
    return []
  }
}

/** The host's list, or the store's refusal, which is never cached: the next
 *  call reads again. One more read covers a store that refused once. */
async function readFromStore(hostId: string): Promise<DeliveredPush[] | { refused: unknown }> {
  const cached = cacheByHost.get(hostId)
  if (cached) {
    return cached
  }
  let refused: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string | null
    try {
      raw = await AsyncStorage.getItem(storageKey(hostId))
    } catch (error) {
      refused = error
      continue
    }
    // A push written while this read was out is newer than what it read, so
    // a slow warm-up must not put the older list back over it.
    const meanwhile = cacheByHost.get(hostId)
    if (meanwhile) {
      return meanwhile
    }
    const parsed = parseDeliveredPushes(raw)
    cacheByHost.set(hostId, parsed)
    return parsed
  }
  return { refused }
}

/** `list` with the push appended as the log keeps it, or null when it is
 *  already there. */
function withPush(list: readonly DeliveredPush[], entry: DeliveredPush): DeliveredPush[] | null {
  // Why the whole previous counter goes: a notification id is not unique
  // across desktop restarts — `buildAgentNotificationId` is
  // `agent:<worktreeId>:<paneKey>:<stateStartedAt>`, so an agent still in the
  // same state re-issues the same id under the new epoch. Entries from the
  // dead counter can never match the live buffer anyway, so they only spend
  // the 256 the desktop accepts. notification-reconnect-catchup.ts drops
  // `session.seen` on an epoch change for exactly this reason.
  const live = list.filter((existing) => existing.notificationEpoch === entry.notificationEpoch)
  // Identity is the TRIPLE the desktop matches on, so dedupe on the id WITHIN
  // an epoch. Deduping on the id alone drops a genuinely new notification and
  // leaves the log reporting a dead entry, which is a duplicate banner.
  if (live.some((existing) => existing.notificationId === entry.notificationId)) {
    return null
  }
  // Oldest first, so slicing from the end keeps the pushes a catch-up is most
  // likely to still be replaying.
  return [...live, entry].slice(-MAX_REPORTED_DELIVERED_PUSHES)
}

/** `list` with every push still waiting to be saved for the host appended. */
function withUnsaved(hostId: string, list: readonly DeliveredPush[]): DeliveredPush[] {
  let merged = [...list]
  for (const entry of unsavedByHost.get(hostId) ?? []) {
    merged = withPush(merged, entry) ?? merged
  }
  return merged
}

async function writeToStore(hostId: string, entries: DeliveredPush[]): Promise<void> {
  cacheByHost.set(hostId, entries)
  try {
    await AsyncStorage.setItem(storageKey(hostId), JSON.stringify(entries))
  } catch (error) {
    // Best effort. A failed write costs the next catch-up a duplicate banner,
    // unless a later push writes the cache first; throwing here would fail the
    // background task that is showing the push.
    console.warn('[storage] could not save the delivered pushes', error)
  }
}

/**
 * Remember that a push already showed this notification, so the next catch-up can
 * tell the desktop not to replay it.
 *
 * Never throws: it runs inside the background task that renders the banner, and a
 * rejection there loses the notification the user was supposed to see.
 */
export async function recordDeliveredPush(
  hostId: string,
  entry: Partial<DeliveredPush>
): Promise<void> {
  if (!isDeliveredPush(entry)) {
    return
  }
  const run = writeTail.then(async () => {
    const current = await readFromStore(hostId)
    if (!Array.isArray(current)) {
      const unsaved = unsavedByHost.get(hostId) ?? []
      unsavedByHost.set(hostId, withPush(unsaved, entry) ?? unsaved)
      console.warn(
        '[storage] could not save the delivered pushes: the stored ones could not be read, so this push is reported from memory until they can be',
        current.refused
      )
      return
    }
    const waiting = unsavedByHost.has(hostId)
    const merged = withUnsaved(hostId, current)
    unsavedByHost.delete(hostId)
    const next = withPush(merged, entry)
    if (next || waiting) {
      await writeToStore(hostId, next ?? merged)
    }
  })
  writeTail = run.catch(() => {})
  await run.catch(() => {})
}

/**
 * Warm the cache for a host. Callers on a hot path `void` this rather than await it.
 *
 * Why this exists: the catch-up request must not await AsyncStorage. A read that
 * hangs — which is the cold-open case the watermark seed timeout was written for
 * — would hold the catch-up open behind it, so a store problem would stop
 * notifications arriving at all. Trading a possible duplicate banner for that is
 * not a trade worth making.
 */
export async function seedDeliveredPushes(hostId: string): Promise<void> {
  if (cacheByHost.has(hostId)) {
    return
  }
  const read = await readFromStore(hostId)
  if (!Array.isArray(read)) {
    // Not cached, so the next connection's warm-up reads again.
    console.warn('[storage] could not read the delivered pushes', read.refused)
  }
}

/**
 * What the cache holds for a host right now, without touching storage, with
 * the pushes this run showed while the stored list could not be read.
 *
 * Returns only those when the seed has not landed yet. That costs at most one
 * duplicate banner on the first catch-up of a cold open, and never a delayed one.
 */
export function cachedDeliveredPushes(hostId: string): DeliveredPush[] {
  return withUnsaved(hostId, cacheByHost.get(hostId) ?? [])
}

/**
 * Drop everything recorded for a host, for a host that has been removed.
 *
 * Why removal and not a completed catch-up: pruning on catch-up would need this
 * code to know what the desktop DID with the reported entries, and that is not
 * something the contract states. Entries the watermark already covers are
 * filtered at request time instead, and the rest age out against the cap.
 */
export async function clearDeliveredPushes(hostId: string): Promise<void> {
  cacheByHost.delete(hostId)
  unsavedByHost.delete(hostId)
  try {
    await AsyncStorage.removeItem(storageKey(hostId))
  } catch {
    // A re-pair re-reads it; a stale list only over-reports.
  }
}

/** Test-only: drop the in-memory cache so a test can act as a fresh process. */
export function resetDeliveredPushCacheForTests(): void {
  cacheByHost.clear()
  unsavedByHost.clear()
  writeTail = Promise.resolve()
}

/**
 * The entries worth sending on a catch-up asking from `lastSeenSeq`.
 *
 * The desktop returns only notifications dispatched after `lastSeenSeq`, so an
 * entry at or below it is already cut and repeating it just makes the request
 * bigger. The epoch has to match: a seq from a counter lifetime the desktop no
 * longer has says nothing about the live one, and comparing across them would
 * drop an entry that is not covered at all.
 */
export function reportableDeliveredPushes(
  entries: readonly DeliveredPush[],
  epoch: string | null,
  lastSeenSeq: number
): DeliveredPush[] {
  return entries.filter(
    (entry) => entry.notificationEpoch !== epoch || entry.notificationSeq > lastSeenSeq
  )
}
