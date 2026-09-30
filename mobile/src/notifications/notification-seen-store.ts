import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * The replay dedup keys this device has delivered for a host, kept across a
 * restart.
 *
 * Why (2026-09-23, "after the app is restarted .. all the old pop ups come up
 * which were resolved already"): the seen-set lived in memory, so it died with
 * the process, and the watermark is allowed to lag what was shown — a failed
 * catch-up holds it back until a later one succeeds (quarantineCatchUpWatermark),
 * and saveWatermark is fire-and-forget. A restart then asked from the lagging
 * seq and re-posted everything past it that the previous run had already put
 * in front of the user. With the keys stored, the replay recognises those.
 *
 * Tied to the counter lifetime the keys index, like the watermark: after a
 * desktop restart the same low seqs mean different notifications, so keys from
 * another epoch are never loaded.
 *
 * Bounded to the desktop's 256-entry replay buffer: a key older than that can
 * never come back in a replay.
 */
const SEEN_STORAGE_KEY_PREFIX = 'orca:mobileNotificationsSeen:'
export const PERSISTED_SEEN_CAP = 256

type PersistedSeen = { epoch: string; keys: string[] }

function seenStorageKey(hostId: string): string {
  return SEEN_STORAGE_KEY_PREFIX + encodeURIComponent(hostId)
}

function parseSeen(raw: string | null): PersistedSeen | null {
  if (raw == null) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { epoch?: unknown; keys?: unknown }
    if (typeof parsed.epoch !== 'string' || parsed.epoch.length === 0 || !Array.isArray(parsed.keys)) {
      return null
    }
    return {
      epoch: parsed.epoch,
      keys: parsed.keys.filter((key): key is string => typeof key === 'string')
    }
  } catch {
    return null
  }
}

/**
 * Hosts whose stored keys this run asked for and the store would not hand
 * over. The run then starts from no keys, and its first write replaced the
 * stored ones with its own: when that run's catch-up could not replay them
 * either, the next restart re-posted popups already resolved (review of
 * 2026-09-30). So the first write for such a host reads again and goes on top
 * of what is stored.
 */
const unreadHosts = new Set<string>()

/** The stored keys, or null when there are none or the record is unreadable.
 *  Fails open: without them a replay posts as it did before they existed. */
export async function loadSeenKeys(hostId: string): Promise<PersistedSeen | null> {
  let raw: string | null
  try {
    raw = await AsyncStorage.getItem(seenStorageKey(hostId))
  } catch (error) {
    unreadHosts.add(hostId)
    // One line, since popups already resolved coming back after a restart
    // look the same whatever the cause.
    console.warn('[storage] could not read the notification seen keys', error)
    return null
  }
  unreadHosts.delete(hostId)
  return parseSeen(raw)
}

/** `value` on top of the keys stored for its counter lifetime, or null when
 *  the store still refuses to read them (after one more try). */
async function withStoredKeys(hostId: string, value: PersistedSeen): Promise<PersistedSeen | null> {
  let refused: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string | null
    try {
      raw = await AsyncStorage.getItem(seenStorageKey(hostId))
    } catch (error) {
      refused = error
      continue
    }
    unreadHosts.delete(hostId)
    const stored = parseSeen(raw)
    // Keys from another counter lifetime index different notifications.
    if (!stored || stored.epoch !== value.epoch) {
      return value
    }
    const fresh = new Set(value.keys)
    const older = stored.keys.filter((key) => !fresh.has(key))
    return { epoch: value.epoch, keys: [...older, ...value.keys].slice(-PERSISTED_SEEN_CAP) }
  }
  console.warn(
    '[storage] could not save the notification seen keys: the stored ones could not be read, and writing over them would lose them',
    refused
  )
  return null
}

type WriteState = { inFlight: boolean; next: PersistedSeen | null }
const writesByHost = new Map<string, WriteState>()

/**
 * Store the latest keys, at most one write in flight per host.
 *
 * Why coalesced: a replay can deliver 256 events in a burst, and each would
 * otherwise queue a write of the whole list. A write already running is left to
 * finish; whatever arrived meanwhile is written once after it, so the last
 * state always lands and the burst costs two writes rather than 256.
 */
export function persistSeenKeys(hostId: string, epoch: string, keys: readonly string[]): void {
  const next: PersistedSeen = { epoch, keys: keys.slice(-PERSISTED_SEEN_CAP) }
  let state = writesByHost.get(hostId)
  if (!state) {
    state = { inFlight: false, next: null }
    writesByHost.set(hostId, state)
  }
  state.next = next
  if (!state.inFlight) {
    void drainSeenWrites(hostId, state)
  }
}

async function drainSeenWrites(hostId: string, state: WriteState): Promise<void> {
  state.inFlight = true
  try {
    while (state.next) {
      const next = state.next
      state.next = null
      const value = unreadHosts.has(hostId) ? await withStoredKeys(hostId, next) : next
      // Not written: the store refused the read (logged, and the next delivery
      // carries every key again), or the host was cleared while it read.
      if (!value || writesByHost.get(hostId) !== state) {
        continue
      }
      try {
        await AsyncStorage.setItem(seenStorageKey(hostId), JSON.stringify(value))
      } catch (error) {
        // Best effort, like the watermark: a lost write costs the next restart
        // its dedup, which is the behaviour before this store existed.
        console.warn('[storage] could not save the notification seen keys', error)
      }
    }
  } finally {
    state.inFlight = false
  }
}

export async function clearSeenKeys(hostId: string): Promise<void> {
  const state = writesByHost.get(hostId)
  if (state) {
    // A queued write must not resurrect the keys of a host that is gone.
    state.next = null
  }
  writesByHost.delete(hostId)
  unreadHosts.delete(hostId)
  await AsyncStorage.removeItem(seenStorageKey(hostId)).catch(() => {})
}
