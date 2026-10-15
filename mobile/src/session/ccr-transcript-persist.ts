import AsyncStorage from '@react-native-async-storage/async-storage'
import type { CcrEvent } from './ccr-session-api'

/**
 * The phone's copy of each Claude session's newest transcript events, as Anthropic sent them, so
 * a tab paints its last conversation in the first frame after a cold start (the user's decision
 * of 2026-10-15: "keep the last 200 rows per session on the phone for the instant first view").
 *
 * Keyed by (account, session): signing an account out wipes exactly its copies, memory and disk.
 * Each session is its own storage item, so one long transcript cannot push another out of a
 * shared blob, with a small index naming them and the account each belongs to. Events are kept
 * with their pictures already moved to cache files (ccr-transcript-decode.ts `slimCcrEvent`), so
 * no base64 is held here.
 */

export const CCR_PERSISTED_EVENTS = 200
export const CCR_PERSISTED_SESSIONS = 12
/** An item over this is cut from its oldest end: Android's AsyncStorage reads an item through a
 *  2 MB cursor window. */
export const CCR_PERSISTED_MAX_CHARS = 1_500_000

const INDEX_KEY = 'codeui:ccr-transcript-v1:index'
const ENTRY_PREFIX = 'codeui:ccr-transcript-v1:'
const WRITE_DEBOUNCE_MS = 500

export type CcrPersistedTranscript = {
  accountId: string
  sessionId: string
  /** Oldest first, only the events that draw a row. */
  events: CcrEvent[]
  /** The highest `sequence_num` the phone had seen: the stream resumes after it. */
  lastSequenceNum: number
  /** The history cursor for the page before `events[0]`, or null when unknown (paging then
   *  starts again from the newest page and skips what is held). */
  olderCursor: string | null
  /** False only when the history said there is nothing older than `events[0]`. */
  hasOlder: boolean
}

type IndexEntry = { key: string; accountId: string; savedAt: number }

const memory = new Map<string, CcrPersistedTranscript>()
let index: IndexEntry[] = []
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let hydrating: Promise<void> | null = null

export function ccrTranscriptKey(accountId: string, sessionId: string): string {
  return `${accountId}\0${sessionId}`
}

function storageKey(key: string): string {
  return `${ENTRY_PREFIX}${encodeURIComponent(key)}`
}

function isPersisted(value: unknown): value is CcrPersistedTranscript {
  const record = value as Partial<CcrPersistedTranscript> | null
  return (
    record !== null &&
    typeof record === 'object' &&
    typeof record.accountId === 'string' &&
    typeof record.sessionId === 'string' &&
    Array.isArray(record.events) &&
    typeof record.lastSequenceNum === 'number' &&
    typeof record.hasOlder === 'boolean'
  )
}

/** Reads every kept copy into memory (app start, session-caches-hydrate.ts). Never rejects: an
 *  unreadable copy is no warm start, not a failure. */
export function hydrateCcrTranscripts(): Promise<void> {
  hydrating ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(INDEX_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      index = Array.isArray(parsed) ? parsed.filter((entry): entry is IndexEntry => typeof entry?.key === 'string' && typeof entry?.accountId === 'string') : []
      const items = await AsyncStorage.multiGet(index.map((entry) => storageKey(entry.key)))
      for (const [, value] of items) {
        try {
          const copy: unknown = value ? JSON.parse(value) : null
          if (isPersisted(copy)) {
            const key = ccrTranscriptKey(copy.accountId, copy.sessionId)
            if (!memory.has(key)) {
              memory.set(key, copy)
            }
          }
        } catch {
          // one unreadable copy costs only that session its warm start
        }
      }
    } catch (error) {
      console.warn(`[ccr-transcript] the kept transcripts could not be read: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
  return hydrating
}

export function readCcrTranscript(accountId: string, sessionId: string): CcrPersistedTranscript | null {
  return memory.get(ccrTranscriptKey(accountId, sessionId)) ?? null
}

/** The newest events up to the caps; a copy cut here no longer knows its older cursor. */
export function trimCcrTranscript(copy: CcrPersistedTranscript): CcrPersistedTranscript {
  let events = copy.events.slice(-CCR_PERSISTED_EVENTS)
  while (events.length > 1 && JSON.stringify(events).length > CCR_PERSISTED_MAX_CHARS) {
    events = events.slice(Math.ceil(events.length / 4))
  }
  const cut = events.length < copy.events.length
  return cut ? { ...copy, events, olderCursor: null, hasOlder: true } : copy
}

function writeIndex(): void {
  void AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index)).catch(() => undefined)
}

export function writeCcrTranscript(copy: CcrPersistedTranscript, now = Date.now()): void {
  const key = ccrTranscriptKey(copy.accountId, copy.sessionId)
  const trimmed = trimCcrTranscript(copy)
  memory.set(key, trimmed)
  index = [...index.filter((entry) => entry.key !== key), { key, accountId: copy.accountId, savedAt: now }]
  while (index.length > CCR_PERSISTED_SESSIONS) {
    const evicted = index.shift()!
    memory.delete(evicted.key)
    void AsyncStorage.removeItem(storageKey(evicted.key)).catch(() => undefined)
  }
  const pending = timers.get(key)
  if (pending) {
    clearTimeout(pending)
  }
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      const latest = memory.get(key)
      if (latest) {
        // A failed write costs the next launch its warm start, nothing else.
        void AsyncStorage.setItem(storageKey(key), JSON.stringify(latest)).catch(() => undefined)
        writeIndex()
      }
    }, WRITE_DEBOUNCE_MS)
  )
}

/** Drops the copies of one signed-out account, or of every account. */
export function wipeCcrTranscripts(accountId: string | 'all'): void {
  const gone = index.filter((entry) => accountId === 'all' || entry.accountId === accountId).map((entry) => entry.key)
  for (const key of memory.keys()) {
    if (accountId === 'all' || memory.get(key)?.accountId === accountId) {
      gone.push(key)
    }
  }
  for (const key of new Set(gone)) {
    memory.delete(key)
    const pending = timers.get(key)
    if (pending) {
      clearTimeout(pending)
      timers.delete(key)
    }
    void AsyncStorage.removeItem(storageKey(key)).catch(() => undefined)
  }
  index = index.filter((entry) => !gone.includes(entry.key))
  writeIndex()
}

export async function flushCcrTranscriptsForTests(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, WRITE_DEBOUNCE_MS + 50))
}

/** A cold start for tests: memory goes, storage stays. */
export function restartCcrTranscriptsForTests(): void {
  memory.clear()
  index = []
  hydrating = null
}

export function resetCcrTranscriptsForTests(): void {
  for (const timer of timers.values()) {
    clearTimeout(timer)
  }
  timers.clear()
  wipeCcrTranscripts('all')
  restartCcrTranscriptsForTests()
}
