import AsyncStorage from '@react-native-async-storage/async-storage'
import type { MobileNativeChatPendingMessage } from '../session/mobile-native-chat-pending-echo'

const PREFIX = 'orca:chatPendingEchoes:'
/** A queued echo older than this is dropped on hydrate: whatever it was, the
 *  agent has long since taken or lost it, and a bubble that outlives that is
 *  only confusing. */
export const PENDING_ECHO_MAX_AGE_MS = 24 * 60 * 60 * 1000

function storageKey(sessionKey: string): string {
  return `${PREFIX}${encodeURIComponent(sessionKey)}`
}

type Stored = {
  savedAt: number
  pending: MobileNativeChatPendingMessage[]
  /** When each echo was FIRST written, by id. `savedAt` is re-stamped on every
   *  write and hydration itself triggers a write, so the age was measured from
   *  the last time the app was opened and the expiry could never fire: an echo
   *  the agent silently consumed sat at the top of the chat forever. */
  createdAt?: Record<string, number>
}

function isPending(value: unknown): value is MobileNativeChatPendingMessage {
  const item = value as Partial<MobileNativeChatPendingMessage> | null
  return (
    typeof item?.id === 'string' &&
    typeof item.text === 'string' &&
    typeof item.expectedOccurrence === 'number' &&
    (item.baselineTailMessageId === null || typeof item.baselineTailMessageId === 'string') &&
    typeof item.baselineResolved === 'boolean' &&
    (item.images === undefined ||
      (Array.isArray(item.images) && item.images.every((uri) => typeof uri === 'string')))
  )
}

/** Optimistic echoes of sends the transcript has not yet shown.
 *
 *  Why persist: a send made while the agent is busy is queued on its input
 *  line, and Claude Code records it only as a queue event, never as a
 *  transcript row. The phone's echo is the only copy, and it was plain state:
 *  leaving the project and coming back made the queued message vanish. */
export async function readNativeChatPendingEchoes(
  sessionKey: string,
  now = Date.now()
): Promise<MobileNativeChatPendingMessage[] | null> {
  try {
    // A route can reopen while retirement is still removing its disk entry.
    await barriers.get(sessionKey)
    const raw = await AsyncStorage.getItem(storageKey(sessionKey))
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<Stored> | null
    if (
      !parsed ||
      typeof parsed.savedAt !== 'number' ||
      now - parsed.savedAt > PENDING_ECHO_MAX_AGE_MS ||
      !Array.isArray(parsed.pending) ||
      !parsed.pending.every(isPending)
    ) {
      return null
    }
    // Each echo ages on its own clock. An entry written before this field
    // existed falls back to the envelope's, which is the old behaviour and no
    // worse than it was.
    const createdAt = parsed.createdAt
    const born = (id: string): number =>
      typeof createdAt?.[id] === 'number' ? createdAt[id]! : parsed.savedAt!
    const fresh = parsed.pending.filter((item) => now - born(item.id) <= PENDING_ECHO_MAX_AGE_MS)
    if (fresh.length === 0) {
      return null
    }
    rememberCreatedAt(sessionKey, fresh, born)
    // `data:` previews are not kept (see native-chat-image-previews.ts).
    return fresh.map((item) => {
      const images = item.images?.filter((uri) => !uri.startsWith('data:'))
      const { images: _dropped, ...rest } = item
      return images?.length ? { ...rest, images } : rest
    })
  } catch {
    return null
  }
}

const barriers = new Map<string, Promise<void>>()
/** First-seen time per echo, per session, for the life of the process. */
const createdAtBySession = new Map<string, Map<string, number>>()

function rememberCreatedAt(
  sessionKey: string,
  pending: readonly MobileNativeChatPendingMessage[],
  born: (id: string) => number
): void {
  const seen = createdAtBySession.get(sessionKey) ?? new Map<string, number>()
  for (const item of pending) {
    if (!seen.has(item.id)) {
      seen.set(item.id, born(item.id))
    }
  }
  createdAtBySession.set(sessionKey, seen)
}

/** Test-only: the map outlives a single test's hooks. */
export function resetNativeChatPendingEchoClocksForTests(): void {
  createdAtBySession.clear()
}

/** Serialized per session; an empty list removes the entry. */
export function writeNativeChatPendingEchoes(
  sessionKey: string,
  pending: readonly MobileNativeChatPendingMessage[],
  now = Date.now()
): Promise<void> {
  const key = storageKey(sessionKey)
  // A pasted screenshot arrives as a multi-megabyte `data:` URI. The read side
  // already drops those; writing them first still stringifies megabytes on the
  // JS thread and can blow AsyncStorage's row cap, which silently loses the
  // whole entry — exactly for the paste this feature exists to keep. Strip at
  // write, as the sibling preview store does.
  const persistable = pending.map((item) => {
    const images = item.images?.filter((uri) => !uri.startsWith('data:'))
    const { images: _dropped, ...rest } = item
    return images?.length ? { ...rest, images } : rest
  })
  rememberCreatedAt(sessionKey, persistable, () => now)
  const seen = createdAtBySession.get(sessionKey)
  const createdAt: Record<string, number> = {}
  for (const item of persistable) {
    createdAt[item.id] = seen?.get(item.id) ?? now
  }
  const stored: Stored = { savedAt: now, pending: [...persistable], createdAt }
  const write = (barriers.get(sessionKey) ?? Promise.resolve()).then(() =>
    pending.length > 0
      ? AsyncStorage.setItem(key, JSON.stringify(stored))
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
