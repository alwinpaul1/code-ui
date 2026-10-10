import AsyncStorage from '@react-native-async-storage/async-storage'

const OUTBOX_KEY = 'orca:chatOutbox'

/** An entry no chat has come back for in this long is dropped when the store is read: the tab it
 *  was for is gone, or nobody opened it for a week. */
const OUTBOX_PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * One message the phone took from the composer and has not yet seen land, written down before the
 * composer empties (native-chat-outbox-sends.ts says when it is written and retired).
 *
 * Why it exists: the composer empties at the tap, and until 2026-10-10 the words then lived only
 * in the send's closure and the screen's React state. A send that the app was closed under (a
 * swipe from Recents, the process killed in the background) took them with it: "the message
 * isn't sent and not even in the input". This is the copy that outlives the process.
 */
export type NativeChatOutboxEntry = {
  /** The client message id: one per press, kept by every automatic retry of that press. */
  id: string
  draftKey: string
  pendingKey: string | null
  /** As typed: what goes back into the composer when it cannot be sent. */
  text: string
  normalizedText: string
  baselineOccurrences: number
  baselineTailMessageId: string | null
  baselineResolved: boolean
  /** When the phone took it, by the phone's clock. */
  createdAt: number
  markersBefore?: number
  /** Prompt receipts the agent had already reported when it left, so an older identical
   *  prompt is never read as this one landing (findBeaconConfirmedSends). */
  knownReceiptNonces?: string[]
  /** A structured session's operation id for this message. Every attempt of the entry sends
   *  this same id, so the host's ledger answers a retry with the first attempt's result
   *  instead of posting the message twice. A new press is a new entry and a new id (#26392). */
  operationId: string
  /** It carried photos or files: those are not resent from here (use-native-chat-outbox-recovery.ts). */
  hasAttachments?: true
  /** The optimistic bubble a photo send drew at its start, to take down if the words go back. */
  echoId?: string
  /** Automatic sends started for this entry, each counted here BEFORE it went out, so a
   *  process that dies mid-resend leaves the next one knowing a copy may already be out. */
  autoAttempts: number
  /** An automatic resend could not deliver it: the bubble says "Not sent" and offers Retry. */
  failed?: true
}

let entries: NativeChatOutboxEntry[] = []
let hydration: Promise<void> | null = null
/** The stored list could not be read: nothing is written over it until a read succeeds. */
let readRefused = false
let writes: Promise<void> = Promise.resolve()
const listeners = new Set<() => void>()

function isEntry(value: unknown): value is NativeChatOutboxEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as Partial<NativeChatOutboxEntry>
  return (
    typeof entry.id === 'string' &&
    typeof entry.draftKey === 'string' &&
    typeof entry.text === 'string' &&
    typeof entry.normalizedText === 'string' &&
    typeof entry.createdAt === 'number' &&
    typeof entry.operationId === 'string' &&
    typeof entry.autoAttempts === 'number'
  )
}

function parseStored(raw: string | null, now: number): NativeChatOutboxEntry[] {
  if (!raw) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter(isEntry).filter((entry) => now - entry.createdAt < OUTBOX_PRUNE_AGE_MS)
      : []
  } catch {
    // A list that will not parse is no list: it is written over by the next change.
    return []
  }
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Reads the stored list once per process; entries written before the read finished stay. */
export function hydrateNativeChatOutbox(): Promise<void> {
  hydration ??= (async () => {
    try {
      const stored = parseStored(await AsyncStorage.getItem(OUTBOX_KEY), Date.now())
      const held = new Set(entries.map((entry) => entry.id))
      entries = [...stored.filter((entry) => !held.has(entry.id)), ...entries]
      readRefused = false
    } catch (error) {
      readRefused = true
      console.warn('[storage] could not read the chat outbox; nothing is written over it this run', error)
    }
    notify()
  })()
  return hydration
}

/** The list as this process holds it now. */
export function nativeChatOutboxEntries(): readonly NativeChatOutboxEntry[] {
  return entries
}

export function subscribeNativeChatOutbox(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Changes the list at once in memory and queues the write of the whole list behind every
 * earlier one. Resolves true once it is on disk, false when it could not be written. Never
 * rejects: a store that refuses costs the outbox its durability, never the send.
 */
export function changeNativeChatOutbox(
  change: (current: readonly NativeChatOutboxEntry[]) => NativeChatOutboxEntry[]
): Promise<boolean> {
  const next = change(entries)
  if (next === entries) {
    return writes.then(() => !readRefused)
  }
  entries = next
  notify()
  const write = writes.then(async () => {
    await hydrateNativeChatOutbox()
    if (readRefused) {
      return false
    }
    try {
      if (entries.length > 0) {
        await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(entries))
      } else {
        await AsyncStorage.removeItem(OUTBOX_KEY)
      }
      return true
    } catch (error) {
      console.warn('[storage] could not save the chat outbox; a message out now is not kept across a restart', error)
      return false
    }
  })
  writes = write.then(() => undefined)
  return write
}

/** Settles once every outbox write asked for so far has landed or failed. The composer's own
 *  stored draft is erased only behind it, so the words are on disk in one place or the other
 *  at every moment of a send (native-chat-drafts.ts). */
export function nativeChatOutboxWritesSettled(): Promise<void> {
  return writes
}

/** Test-only: the list is module state and outlives a single test; this is a process restart. */
export function resetNativeChatOutboxForTests(): void {
  entries = []
  hydration = null
  readRefused = false
  writes = Promise.resolve()
  listeners.clear()
}
