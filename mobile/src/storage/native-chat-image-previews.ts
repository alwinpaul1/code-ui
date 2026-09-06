import AsyncStorage from '@react-native-async-storage/async-storage'

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

export async function readNativeChatImagePreviews(
  sessionKey: string
): Promise<Record<string, string[]> | null> {
  try {
    const raw = await AsyncStorage.getItem(previewStorageKey(sessionKey))
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
  const write = (barriers.get(sessionKey) ?? Promise.resolve()).then(() =>
    Object.keys(kept).length > 0
      ? AsyncStorage.setItem(key, JSON.stringify(kept))
      : AsyncStorage.removeItem(key)
  )
  const barrier = write.catch(() => undefined)
  barriers.set(sessionKey, barrier)
  void barrier.then(() => {
    if (barriers.get(sessionKey) === barrier) {
      barriers.delete(sessionKey)
    }
  })
  return write
}
