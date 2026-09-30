import AsyncStorage from '@react-native-async-storage/async-storage'

// Why: the in-memory project caches (last tab list, last transcript) only help
// while the process lives. Persisting them lets a cold start paint a project
// from the last visit too. Writes are debounced and best effort; a missing or
// corrupt entry just means the old spinner path for that one open.
//
// Fail-open both ways, as reading-positions.ts is. The stored copy is ONE
// blob holding every entry, so a write carries whatever memory holds, and a
// write made while the blob is being read, or after its read failed, replaces
// every entry the phone could not read back with the few set since. So once
// a hydrate has started, nothing is written until a read has succeeded: a
// write waits for the read in flight (never a second one), or tries a failed
// read again first; while storage stays unreadable this run's entries live
// in memory only. The app hydrates every store at start
// (session-caches-hydrate.ts), before its first write is due; a store that
// was never asked to hydrate writes as it always did.

const WRITE_DEBOUNCE_MS = 600

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseEntries<T>(raw: string | null | undefined): [string, T][] {
  if (!raw) {
    return []
  }
  try {
    const entries = JSON.parse(raw) as unknown
    return Array.isArray(entries)
      ? entries.filter((entry): entry is [string, T] => Array.isArray(entry) && typeof entry[0] === 'string')
      : []
  } catch {
    // Corrupt: an empty blob, which the next write replaces.
    return []
  }
}

export function createPersistedMap<T>(args: {
  storageKey: string
  maxEntries: number
  /** Shrink an entry before it is written (e.g. keep only a transcript tail). */
  trim?: (value: T) => T
}): {
  get: (key: string) => T | undefined
  set: (key: string, value: T) => void
  /** Reads the stored copy into memory. Resolves once it has been read, or
   *  once the read failed; never rejects. A call after a failure reads
   *  again, and concurrent calls share one read. */
  hydrate: () => Promise<void>
  reset: () => void
} {
  let map = new Map<string, T>()
  /** A hydrate has been asked for, so writes wait for a successful read. */
  let readAsked = false
  /** A read of the stored blob has succeeded, so a write can carry it all. */
  let hydrated = false
  let reading: Promise<boolean> | null = null
  /** Bumped by `reset`, so a read still in flight from before is dropped. */
  let generation = 0
  /** Memory holds a change storage does not have yet. */
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function evictOverCap(): void {
    while (map.size > args.maxEntries) {
      const oldest = map.keys().next().value
      if (oldest === undefined) {
        break
      }
      map.delete(oldest)
    }
  }

  async function readOnce(started: number): Promise<boolean> {
    let raw: string | null
    try {
      raw = await AsyncStorage.getItem(args.storageKey)
    } catch (error) {
      console.warn(
        `[session-cache] ${args.storageKey} unreadable (${describeFailure(error)}); nothing is written to it until a read succeeds`
      )
      return false
    }
    if (started !== generation) {
      return false
    }
    // What was stored is older than anything set in this run, so it goes
    // first and is the first evicted; a visit made while the read was in
    // flight, or while storage could not be read, wins over its stored copy.
    const merged = new Map<string, T>()
    for (const [key, value] of parseEntries<T>(raw)) {
      if (!map.has(key)) {
        merged.set(key, value)
      }
    }
    for (const [key, value] of map) {
      merged.set(key, value)
    }
    map = merged
    evictOverCap()
    hydrated = true
    return true
  }

  /** True once the blob has been read, now or earlier. */
  function readStored(): Promise<boolean> {
    readAsked = true
    if (hydrated) {
      return Promise.resolve(true)
    }
    if (reading) {
      return reading
    }
    const read = readOnce(generation)
    reading = read
    // Settled either way, the next caller asks again: a failed read is
    // retried, and a good one has set `hydrated`.
    void read.then(() => {
      if (reading === read) {
        reading = null
      }
    })
    return read
  }

  function writeNow(): void {
    dirty = false
    const entries = Array.from(map.entries()).map(([key, value]) => [key, args.trim ? args.trim(value) : value])
    void AsyncStorage.setItem(args.storageKey, JSON.stringify(entries)).catch(() => {})
  }

  function flush(): void {
    if (hydrated || !readAsked) {
      // A write that waited for the read may already have carried this one.
      if (dirty) {
        writeNow()
      }
      return
    }
    void readStored().then((read) => {
      if (read && dirty) {
        writeNow()
      }
    })
  }

  function scheduleWrite(): void {
    dirty = true
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      flush()
    }, WRITE_DEBOUNCE_MS)
  }

  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.delete(key)
      map.set(key, value)
      evictOverCap()
      scheduleWrite()
    },
    hydrate: async () => {
      // Visits made while the blob was unread are only in memory; once it
      // has been read, write them with the rest.
      if ((await readStored()) && dirty && !timer) {
        scheduleWrite()
      }
    },
    reset: () => {
      generation += 1
      map = new Map()
      readAsked = false
      hydrated = false
      reading = null
      dirty = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
