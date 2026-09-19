import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Where the reader last was in a document, so a 200-page PDF put down at page
 * 47 opens at page 47 and not at page 1 — after a tab switch, after the app is
 * swiped out of recents, after a reboot (asked for 2026-09-19).
 *
 * One blob under one key, not a key per file: the set is small (a few hundred
 * entries at most, ~100 bytes each), it is read once per process, and a single
 * blob gives the size cap for free. Memory is the working copy; storage is the
 * durable one. Every read waits for the one hydration; every save updates
 * memory at once and lands in storage on a short trailing debounce, so a
 * scroll gesture costs one write, not sixty.
 *
 * Fail-open, both ways. If the blob cannot be read the reader starts at the
 * top, and nothing is written until a later read succeeds — a write over an
 * unread blob would replace every other file's position with the one entry in
 * memory. If a write fails the next save tries again.
 */
export type ReadingPosition =
  | {
      readonly kind: 'pdf'
      /** 1-based, as react-native-pdf counts. */
      readonly page: number
      readonly pageCount: number
      readonly savedAt: number
    }
  | {
      readonly kind: 'scroll'
      /** Content offset in px at the time of the save. */
      readonly offset: number
      /** Content height in px at the time of the save; lets a re-rendered
       *  document of a different height scale the offset instead of
       *  landing on the wrong paragraph. */
      readonly contentHeight: number
      readonly savedAt: number
    }

const STORAGE_KEY = 'orca:readingPositions'
/** Oldest entries beyond this many are dropped on the next write. */
export const READING_POSITION_CAP = 300
/** Trailing debounce for the storage write after a save. Short enough that
 *  Home-then-swipe-away — a second or more of JS still running — lands it. */
export const READING_POSITION_WRITE_DELAY_MS = 300
/** A scroll offset below this reads as "the top"; nothing is remembered. */
const SCROLL_TOP_THRESHOLD_PX = 24

/** One document on one host. The path is whatever the opening surface shows
 *  (worktree-relative for files, absolute for terminal artifacts); the same
 *  file opened from the explorer and from a session tab shares a position. */
export function readingPositionKey(hostId: string, worktreeId: string, path: string): string {
  return `${hostId}\u0000${worktreeId}\u0000${path}`
}

let memory = new Map<string, ReadingPosition>()
/** Keys cleared before the blob was read; hydration must not bring them back. */
let clearedBeforeHydration = new Set<string>()
let hydration: Promise<void> | null = null
let hydrated = false
let writeTimer: ReturnType<typeof setTimeout> | null = null
let writeBarrier: Promise<void> = Promise.resolve()

function isPosition(value: unknown): value is ReadingPosition {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  if (typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)) {
    return false
  }
  if (record.kind === 'pdf') {
    return (
      Number.isInteger(record.page) &&
      (record.page as number) >= 1 &&
      Number.isInteger(record.pageCount) &&
      (record.pageCount as number) >= 1
    )
  }
  if (record.kind === 'scroll') {
    return (
      typeof record.offset === 'number' &&
      Number.isFinite(record.offset) &&
      record.offset >= 0 &&
      typeof record.contentHeight === 'number' &&
      Number.isFinite(record.contentHeight) &&
      record.contentHeight > 0
    )
  }
  return false
}

function parseBlob(raw: string | null): Map<string, ReadingPosition> {
  const parsed = new Map<string, ReadingPosition>()
  if (!raw) {
    return parsed
  }
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    // A corrupt blob is an empty one; the next write replaces it.
    return parsed
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return parsed
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isPosition(entry)) {
      parsed.set(key, entry)
    }
  }
  return parsed
}

function hydrate(): Promise<void> {
  if (hydrated) {
    return Promise.resolve()
  }
  if (!hydration) {
    hydration = (async () => {
      let raw: string | null
      try {
        raw = await AsyncStorage.getItem(STORAGE_KEY)
      } catch {
        // Unreadable: start at the top, and keep every save in memory only
        // until a read succeeds (see the module comment).
        hydration = null
        return
      }
      const stored = parseBlob(raw)
      // Saves that landed before the read (while it was in flight, or while
      // storage was unreadable) are newer than the blob; they win, and they
      // are still only in memory, so they get written now.
      const pending = memory.size > 0 || clearedBeforeHydration.size > 0
      for (const key of clearedBeforeHydration) {
        stored.delete(key)
      }
      clearedBeforeHydration = new Set()
      for (const [key, position] of memory) {
        stored.set(key, position)
      }
      memory = stored
      hydrated = true
      if (pending) {
        scheduleWrite()
      }
    })()
  }
  return hydration
}

/** The stored position for a document, or null when there is none. Waits for
 *  the one hydration; after that it answers from memory. */
export async function loadReadingPosition(key: string): Promise<ReadingPosition | null> {
  await hydrate()
  return memory.get(key) ?? null
}

/** The position in memory right now, or undefined before hydration has run. */
export function peekReadingPosition(key: string): ReadingPosition | null | undefined {
  if (!hydrated) {
    return undefined
  }
  return memory.get(key) ?? null
}

function capped(entries: Map<string, ReadingPosition>): Record<string, ReadingPosition> {
  const sorted = [...entries.entries()].sort((a, b) => b[1].savedAt - a[1].savedAt)
  return Object.fromEntries(sorted.slice(0, READING_POSITION_CAP))
}

function writeNow(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (!hydrated) {
    return Promise.resolve()
  }
  const snapshot = capped(memory)
  const write = writeBarrier.then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)))
  // The barrier only orders writes; a failed one must not poison the chain.
  writeBarrier = write.catch(() => undefined)
  return write
}

function scheduleWrite(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
  }
  writeTimer = setTimeout(() => {
    writeTimer = null
    void writeNow().catch(() => undefined)
  }, READING_POSITION_WRITE_DELAY_MS)
}

/** Remember where the reader is. The top of a document (page 1, offset ~0)
 *  is forgotten instead of stored: that is where an unknown document opens
 *  anyway, and it keeps the blob to documents someone actually put down
 *  partway. */
export function saveReadingPosition(
  key: string,
  position:
    | { kind: 'pdf'; page: number; pageCount: number }
    | { kind: 'scroll'; offset: number; contentHeight: number }
): void {
  const atTop =
    position.kind === 'pdf' ? position.page <= 1 : position.offset < SCROLL_TOP_THRESHOLD_PX
  if (atTop) {
    clearReadingPosition(key)
    return
  }
  const entry: ReadingPosition =
    position.kind === 'pdf'
      ? {
          kind: 'pdf',
          page: Math.floor(position.page),
          pageCount: Math.max(1, Math.floor(position.pageCount)),
          savedAt: Date.now()
        }
      : {
          kind: 'scroll',
          offset: position.offset,
          contentHeight: position.contentHeight,
          savedAt: Date.now()
        }
  if (!isPosition(entry)) {
    return
  }
  memory.set(key, entry)
  if (hydrated) {
    scheduleWrite()
  } else {
    // Hydration folds this in and writes when it lands; if the last read
    // failed, this is the retry.
    void hydrate()
  }
}

export function clearReadingPosition(key: string): void {
  if (!hydrated) {
    clearedBeforeHydration.add(key)
    memory.delete(key)
    void hydrate()
    return
  }
  if (memory.delete(key)) {
    scheduleWrite()
  }
}

/** Write whatever is pending now. Called when a reader unmounts, so a
 *  position saved in the last 300 ms is not lost with the screen. */
export function flushReadingPositions(): Promise<void> {
  if (!writeTimer) {
    return writeBarrier
  }
  return writeNow()
}

/** Forgets the memory copy and any pending write, leaving storage as it is —
 *  the shape of a process death. */
export function resetReadingPositionMemoryForTests(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  memory = new Map()
  clearedBeforeHydration = new Set()
  hydration = null
  hydrated = false
  writeBarrier = Promise.resolve()
}
