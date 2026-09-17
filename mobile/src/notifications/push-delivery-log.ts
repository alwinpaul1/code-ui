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
 */
const cacheByHost = new Map<string, DeliveredPush[]>()
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

async function readFromStore(hostId: string): Promise<DeliveredPush[]> {
  const cached = cacheByHost.get(hostId)
  if (cached) {
    return cached
  }
  let parsed: DeliveredPush[] = []
  try {
    const raw = await AsyncStorage.getItem(storageKey(hostId))
    if (raw != null) {
      const value: unknown = JSON.parse(raw)
      // A corrupt or partially-written record degrades to "no pushes delivered",
      // which costs a duplicate banner rather than the whole catch-up.
      parsed = Array.isArray(value) ? value.filter(isDeliveredPush) : []
    }
  } catch {
    parsed = []
  }
  cacheByHost.set(hostId, parsed)
  return parsed
}

async function writeToStore(hostId: string, entries: DeliveredPush[]): Promise<void> {
  cacheByHost.set(hostId, entries)
  try {
    await AsyncStorage.setItem(storageKey(hostId), JSON.stringify(entries))
  } catch {
    // Best effort. A failed write costs the next catch-up a duplicate banner;
    // throwing here would fail the background task that is showing the push.
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
    if (current.some((existing) => existing.notificationId === entry.notificationId)) {
      return
    }
    const next = [...current, entry]
    // Oldest first, so slicing from the end keeps the pushes a catch-up is most
    // likely to still be replaying.
    await writeToStore(hostId, next.slice(-MAX_REPORTED_DELIVERED_PUSHES))
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
  await readFromStore(hostId).catch(() => {})
}

/**
 * What the cache holds for a host right now, without touching storage.
 *
 * Returns nothing when the seed has not landed yet. That costs at most one
 * duplicate banner on the first catch-up of a cold open, and never a delayed one.
 */
export function cachedDeliveredPushes(hostId: string): DeliveredPush[] {
  return [...(cacheByHost.get(hostId) ?? [])]
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
  try {
    await AsyncStorage.removeItem(storageKey(hostId))
  } catch {
    // A re-pair re-reads it; a stale list only over-reports.
  }
}

/** Test-only: drop the in-memory cache so a test can act as a fresh process. */
export function resetDeliveredPushCacheForTests(): void {
  cacheByHost.clear()
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
