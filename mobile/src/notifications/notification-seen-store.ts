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

/** The stored keys, or null when there are none or the record is unreadable.
 *  Fails open: without them a replay posts as it did before they existed. */
export async function loadSeenKeys(hostId: string): Promise<PersistedSeen | null> {
  try {
    const raw = await AsyncStorage.getItem(seenStorageKey(hostId))
    if (raw == null) {
      return null
    }
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
      const value = state.next
      state.next = null
      try {
        await AsyncStorage.setItem(seenStorageKey(hostId), JSON.stringify(value))
      } catch {
        // Best effort, like the watermark: a lost write costs the next restart
        // its dedup, which is the behaviour before this store existed.
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
  await AsyncStorage.removeItem(seenStorageKey(hostId)).catch(() => {})
}
