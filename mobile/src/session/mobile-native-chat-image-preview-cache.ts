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
 * last written or read for each session in this run, and the most recent
 * sessions' previews for the next one, the same twelve a transcript is kept
 * for. Only what storage keeps is held: `data:` previews are left out there.
 */
const RECENT_SESSIONS = 12

const lastKnown = new Map<string, Record<string, string[]>>()
const recent = createPersistedMap<Record<string, string[]>>({
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
  lastKnown.set(sessionKey, previews)
  recent.set(sessionKey, previews)
}

/** Writes a session's previews to storage, and remembers what storage keeps. */
export function saveNativeChatImagePreviews(
  sessionKey: string,
  previews: Record<string, string[]>
): Promise<void> {
  remember(sessionKey, persistableImagePreviews(previews))
  return writeNativeChatImagePreviews(sessionKey, previews)
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
  recent.reset()
}
