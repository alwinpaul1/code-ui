import AsyncStorage from '@react-native-async-storage/async-storage'

const DRAFT_PREFIX = 'orca:chatDraft:'

function draftStorageKey(scopeKey: string): string {
  return `${DRAFT_PREFIX}${encodeURIComponent(scopeKey)}`
}

/**
 * Unsent composer text per host+worktree+tab.
 *
 * Why persist: the session route unmounts when the user opens another project,
 * and its drafts were plain component state, so anything half-typed vanished on
 * the way back. Storage survives the unmount (and Android reclaiming the app).
 */
export async function readNativeChatDraft(scopeKey: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(draftStorageKey(scopeKey))
  } catch {
    return null
  }
}

const barriers = new Map<string, Promise<void>>()

/** Serialized per scope so a slow older write cannot land over a newer draft.
 *  An empty draft removes the entry. */
export function writeNativeChatDraft(scopeKey: string, text: string): Promise<void> {
  const key = draftStorageKey(scopeKey)
  const write = (barriers.get(scopeKey) ?? Promise.resolve()).then(() =>
    text ? AsyncStorage.setItem(key, text) : AsyncStorage.removeItem(key)
  )
  const barrier = write.catch(() => undefined)
  barriers.set(scopeKey, barrier)
  void barrier.then(() => {
    if (barriers.get(scopeKey) === barrier) {
      barriers.delete(scopeKey)
    }
  })
  return write
}
