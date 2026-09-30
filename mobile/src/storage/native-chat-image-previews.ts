import AsyncStorage from '@react-native-async-storage/async-storage'
import { barrierAfterWrite } from './refused-write-log'

const PREVIEW_PREFIX = 'orca:chatImagePreviews:'

function previewStorageKey(sessionKey: string): string {
  return `${PREVIEW_PREFIX}${encodeURIComponent(sessionKey)}`
}

/** Phone-local preview URIs per transcript message id, for one chat session.
 *
 *  Why persist: the phone cannot fetch its own upload back from the host (the
 *  chat file route only grants paths an assistant message cited), so once the
 *  in-memory map went with an unmount the bubble lost its picture for good.
 *  `data:` URIs are left out: a pasted screenshot is megabytes of base64 and
 *  AsyncStorage on Android is capped at a few MB in total. */
export function persistableImagePreviews(
  previews: Record<string, string[]>
): Record<string, string[]> {
  const kept: Record<string, string[]> = {}
  for (const [messageId, uris] of Object.entries(previews)) {
    const files = uris.filter((uri) => !uri.startsWith('data:'))
    if (files.length > 0) {
      kept[messageId] = files
    }
  }
  return kept
}

/** Null when nothing is stored, and when storage refused the read: use
 *  readNativeChatImagePreviewRecord before writing over the stored map. */
export async function readNativeChatImagePreviews(
  sessionKey: string
): Promise<Record<string, string[]> | null> {
  const read = await readNativeChatImagePreviewRecord(sessionKey)
  return 'refused' in read ? null : read.previews
}

/**
 * The stored previews, or why storage would not hand them over. A refused
 * read is kept apart from a session with nothing stored: the whole map sits
 * under one key, and a save that took a refused read for an empty one wrote
 * its own map over every earlier photo of the chat (2026-09-30). Nothing
 * stored, or a value that will not parse, is `previews: null`.
 */
export async function readNativeChatImagePreviewRecord(
  sessionKey: string
): Promise<{ previews: Record<string, string[]> | null } | { refused: unknown }> {
  let raw: string | null
  try {
    // A chat can come back while its last write is still landing (a removal
    // included); a read that beat it brought the previous previews back. The
    // barrier never rejects, so a failed write in front of it cannot fail
    // this read. With no write in flight the read starts at once, in the
    // caller's own tick, as it always did.
    const writing = barriers.get(sessionKey)
    if (writing) {
      await writing
    }
    raw = await AsyncStorage.getItem(previewStorageKey(sessionKey))
  } catch (error) {
    return { refused: error }
  }
  return { previews: parseStoredPreviews(raw) }
}

function parseStoredPreviews(raw: string | null): Record<string, string[]> | null {
  try {
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const previews: Record<string, string[]> = {}
    for (const [messageId, uris] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(uris) && uris.every((uri) => typeof uri === 'string')) {
        previews[messageId] = uris as string[]
      }
    }
    return previews
  } catch {
    return null
  }
}

const barriers = new Map<string, Promise<void>>()

/** Serialized per session so a slow older write cannot land over a newer map.
 *  An empty map removes the entry. */
export function writeNativeChatImagePreviews(
  sessionKey: string,
  previews: Record<string, string[]>
): Promise<void> {
  const key = previewStorageKey(sessionKey)
  const kept = persistableImagePreviews(previews)
  const saving = Object.keys(kept).length > 0
  const write = (barriers.get(sessionKey) ?? Promise.resolve()).then(() =>
    saving ? AsyncStorage.setItem(key, JSON.stringify(kept)) : AsyncStorage.removeItem(key)
  )
  const barrier = barrierAfterWrite(write, 'chat photo previews', saving ? 'save' : 'erase')
  barriers.set(sessionKey, barrier)
  void barrier.then(() => {
    if (barriers.get(sessionKey) === barrier) {
      barriers.delete(sessionKey)
    }
  })
  return write
}
