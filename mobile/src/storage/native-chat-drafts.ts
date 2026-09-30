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
    // A route can reopen while the send's empty write is still removing the
    // entry; a read that beat it handed the sent text back as the draft. The
    // barrier never rejects, so a failed write in front of it cannot fail
    // this read. With no write in flight the read starts at once, in the
    // caller's own tick, as it always did.
    const writing = barriers.get(scopeKey)
    if (writing) {
      await writing
    }
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
