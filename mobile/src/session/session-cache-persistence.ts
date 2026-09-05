import AsyncStorage from '@react-native-async-storage/async-storage'

// Why: the in-memory project caches (last tab list, last transcript) only help
// while the process lives. Persisting them lets a cold start paint a project
// from the last visit too. Writes are debounced and best effort; a missing or
// corrupt entry just means the old spinner path for that one open.

const WRITE_DEBOUNCE_MS = 600

export function createPersistedMap<T>(args: {
  storageKey: string
  maxEntries: number
  /** Shrink an entry before it is written (e.g. keep only a transcript tail). */
  trim?: (value: T) => T
}): {
  get: (key: string) => T | undefined
  set: (key: string, value: T) => void
  hydrate: () => Promise<void>
  reset: () => void
} {
  const map = new Map<string, T>()
  let hydrated = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function scheduleWrite(): void {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      const entries = Array.from(map.entries()).map(([key, value]) => [
        key,
        args.trim ? args.trim(value) : value
      ])
      void AsyncStorage.setItem(args.storageKey, JSON.stringify(entries)).catch(() => {})
    }, WRITE_DEBOUNCE_MS)
  }

  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.delete(key)
      map.set(key, value)
      while (map.size > args.maxEntries) {
        const oldest = map.keys().next().value
        if (oldest === undefined) {
          break
        }
        map.delete(oldest)
      }
      scheduleWrite()
    },
    hydrate: async () => {
      if (hydrated) {
        return
      }
      hydrated = true
      try {
        const raw = await AsyncStorage.getItem(args.storageKey)
        if (!raw) {
          return
        }
        const entries = JSON.parse(raw) as [string, T][]
        if (!Array.isArray(entries)) {
          return
        }
        for (const [key, value] of entries) {
          // Why: a visit that happened while the read was in flight wins.
          if (typeof key === 'string' && !map.has(key)) {
            map.set(key, value)
          }
        }
      } catch {
        // Corrupt or unavailable storage: start empty.
      }
    },
    reset: () => {
      map.clear()
      hydrated = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
