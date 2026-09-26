import {
  persistableImagePreviews,
  readNativeChatImagePreviews,
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

async function saveInOrder(sessionKey: string, previews: Record<string, string[]>): Promise<void> {
  if (lastKnown.has(sessionKey)) {
    remember(sessionKey, previews)
    return writeNativeChatImagePreviews(sessionKey, previews)
  }
  const stored = await readNativeChatImagePreviews(sessionKey)
  // The chat's own read may have come back meanwhile: it is storage too.
  const merged = stored ? { ...stored, ...lastKnown.get(sessionKey), ...previews } : previews
  remember(sessionKey, merged)
  return writeNativeChatImagePreviews(sessionKey, merged)
}

/** Reads a session's previews from storage, and remembers them unless this
 *  run wrote the session meanwhile. A failed read is remembered as nothing. */
export async function loadNativeChatImagePreviews(
  sessionKey: string
): Promise<Record<string, string[]> | null> {
  const stored = await readNativeChatImagePreviews(sessionKey)
  if (stored && !lastKnown.has(sessionKey)) {
    remember(sessionKey, stored)
  }
  return stored
}

/** The previous run's recent sessions, before any chat opens. A missing or
 *  corrupt entry leaves each chat to read its own, as before. */
export function hydrateNativeChatImagePreviewCache(): Promise<void> {
  return recent.hydrate()
}

export function resetNativeChatImagePreviewCacheForTests(): void {
  lastKnown.clear()
  saving.clear()
  recent.reset()
}
