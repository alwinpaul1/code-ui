import {
  persistableImagePreviews,
  readNativeChatImagePreviewRecord,
  writeNativeChatImagePreviews
} from '../storage/native-chat-image-previews'
import { createPersistedMap } from './session-cache-persistence'

/**
 * The phone's photo previews per chat session, known without waiting for a
 * storage read.
 *
 * A chat that comes back is painted at once from the kept transcript
 * (mobile-native-chat-transcript-cache.ts), in this run from memory and after
 * a relaunch from the app-start caches. The previews arrived only from a
 * storage read in an effect after that paint, so until it landed every photo
 * the phone had sent in the chat was drawn as "Image on Desktop" (2026-09-26).
 *
 * The per-session entries in storage stay the record. This holds what was
 * last written or read for the sessions of this run, `data:` previews (a
 * marked-up photo, a clipboard paste) included, for as many sessions as the
 * draft store keeps previews for while mounted. For the next run it keeps the
 * most recent sessions' previews as storage keeps them, without `data:`, the
 * same twelve a transcript is kept for.
 */
const RUN_SESSIONS = 8
const RECENT_SESSIONS = 12

const lastKnown = new Map<string, Record<string, string[]>>()
/** A session's save still in flight, which the next one waits for. */
const saving = new Map<string, Promise<void>>()
/** Previews a save could not write because storage would not read the
 *  session to merge them in: the next save that can read carries them. */
const unsaved = new Map<string, Record<string, string[]>>()
/** Sessions a skipped save has been logged for, until a save lands. */
const refusalLogged = new Set<string>()
const recent =createPersistedMap<Record<string, string[]>>({
  storageKey: 'codeui:chat-image-previews-recent',
  maxEntries: RECENT_SESSIONS
})

/** A session's previews as this run last knew them, or as the previous run
 *  left them for a recent session. Undefined when neither knows. */
export function knownNativeChatImagePreviews(sessionKey: string): Record<string, string[]> | undefined {
  return lastKnown.get(sessionKey) ?? recent.get(sessionKey)
}

/** Whether this run wrote or read the session, so storage holds nothing newer. */
export function nativeChatImagePreviewsSettledThisRun(sessionKey: string): boolean {
  return lastKnown.has(sessionKey)
}

function remember(sessionKey: string, previews: Record<string, string[]>): void {
  lastKnown.delete(sessionKey)
  lastKnown.set(sessionKey, previews)
  for (const oldest of lastKnown.keys()) {
    if (lastKnown.size <= RUN_SESSIONS) {
      break
    }
    lastKnown.delete(oldest)
  }
  recent.set(sessionKey, persistableImagePreviews(previews))
}

/**
 * Writes a session's previews to storage, and remembers them.
 *
 * A session this run never read may hold photos in storage the map being
 * written never saw: a photo landed, then the tab changed, before the chat's
 * read came back. Writing the map alone replaced the entry and lost them for
 * good (review, 2026-09-26), so such a write goes on top of what storage has.
 */
export function saveNativeChatImagePreviews(
  sessionKey: string,
  previews: Record<string, string[]>
): Promise<void> {
  const earlier = saving.get(sessionKey)
  if (!earlier && lastKnown.has(sessionKey)) {
    remember(sessionKey, previews)
    return writeNativeChatImagePreviews(sessionKey, previews)
  }
  // In the order they were made: a save that waits for its read must not
  // land after a later one (review, 2026-09-26).
  // Nothing in flight: start now, so its read is asked for before anything
  // the caller does next.
  const run = earlier ? earlier.then(() => saveInOrder(sessionKey, previews)) : saveInOrder(sessionKey, previews)
  const done = run.catch(() => undefined)
  saving.set(sessionKey, done)
  void done.then(() => {
    if (saving.get(sessionKey) === done) {
      saving.delete(sessionKey)
    }
  })
  return run
}

/**
 * A save the run has not read the session for. A read storage refused is not
 * an empty session: written over, the stored map lost every earlier photo of
 * the chat, drawn as "Image on Desktop" from then on (2026-09-30). One more
 * read covers a store that refused once; one that still refuses gets no
 * write, the previews wait in `unsaved` for the next save, and one line says
 * why.
 */
async function saveInOrder(sessionKey: string, previews: Record<string, string[]>): Promise<void> {
  if (lastKnown.has(sessionKey)) {
    remember(sessionKey, previews)
    return writeNativeChatImagePreviews(sessionKey, previews)
  }
  let read = await readNativeChatImagePreviewRecord(sessionKey)
  if ('refused' in read) {
    read = await readNativeChatImagePreviewRecord(sessionKey)
  }
  if ('refused' in read) {
    unsaved.set(sessionKey, { ...unsaved.get(sessionKey), ...previews })
    if (!refusalLogged.has(sessionKey)) {
      refusalLogged.add(sessionKey)
      console.warn(
        '[storage] could not save the chat photo previews: the stored ones could not be read, and writing over them would drop them',
        read.refused
      )
    }
    return
  }
  refusalLogged.delete(sessionKey)
  const waiting = unsaved.get(sessionKey)
  unsaved.delete(sessionKey)
  // The chat's own read may have come back meanwhile: it is storage too.
  const merged = { ...read.previews, ...lastKnown.get(sessionKey), ...waiting, ...previews }
  remember(sessionKey, merged)
  return writeNativeChatImagePreviews(sessionKey, merged)
}

/** Reads a session's previews from storage, and remembers them unless this
 *  run wrote the session meanwhile. A failed read is remembered as nothing,
 *  so the next save still reads before it writes; a refused one says so. */
export async function loadNativeChatImagePreviews(
  sessionKey: string
): Promise<Record<string, string[]> | null> {
  const read = await readNativeChatImagePreviewRecord(sessionKey)
  if ('refused' in read) {
    console.warn('[storage] could not read the chat photo previews', read.refused)
    return null
  }
  if (read.previews && !lastKnown.has(sessionKey)) {
    remember(sessionKey, read.previews)
  }
  return read.previews
}

/** The previous run's recent sessions, before any chat opens. A missing or
 *  corrupt entry leaves each chat to read its own, as before. */
export function hydrateNativeChatImagePreviewCache(): Promise<void> {
  return recent.hydrate()
}

export function resetNativeChatImagePreviewCacheForTests(): void {
  lastKnown.clear()
  saving.clear()
  unsaved.clear()
  refusalLogged.clear()
  recent.reset()
}
