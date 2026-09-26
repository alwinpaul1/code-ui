import { withPhotosWhere, type MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { createPersistedMap } from './session-cache-persistence'

/**
 * The phone's photo sends still waiting for their rows, per session, as the
 * draft store last wrote them.
 *
 * The store reads its sends back from storage in an effect after a chat comes
 * back, and the kept transcript is painted before that. So a photo whose row
 * landed while its chat was away (queued mid-turn, dequeued at the end of the
 * turn while the user was in another project, or with the app closed) was
 * drawn from the row alone, as "Image on Desktop", until the read came back
 * (review, 2026-09-26). The chat binds the photos from here until then
 * (previewsAsDrawn).
 *
 * For this run the sends are held as written, `data:` previews included, for
 * as many sessions as the draft store keeps previews for. For the next run
 * the most recent sessions' sends are kept as storage keeps them, without
 * `data:`, the same twelve a transcript is kept for, and read at app start.
 */
const RUN_SESSIONS = 8
const RECENT_SESSIONS = 12
const waiting = new Map<string, MobileNativeChatPendingMessage[]>()
const recent = createPersistedMap<MobileNativeChatPendingMessage[]>({
  storageKey: 'codeui:chat-waiting-photo-sends-recent',
  maxEntries: RECENT_SESSIONS
})

/** What the store just wrote for a session; its photo sends are kept. */
export function rememberWaitingPhotoSends(
  sessionKey: string,
  pending: readonly MobileNativeChatPendingMessage[]
): void {
  const photos = pending.filter((item) => item.images?.length)
  waiting.delete(sessionKey)
  // A session with no photo send takes no place among the recent ones,
  // unless it held one there that is now gone.
  if (photos.length > 0 || recent.get(sessionKey)?.length) {
    recent.set(sessionKey, withoutDataPreviews(photos))
  }
  if (photos.length === 0) {
    return
  }
  waiting.set(sessionKey, photos)
  for (const oldest of waiting.keys()) {
    if (waiting.size <= RUN_SESSIONS) {
      break
    }
    waiting.delete(oldest)
  }
}

function withoutDataPreviews(
  photos: readonly MobileNativeChatPendingMessage[]
): MobileNativeChatPendingMessage[] {
  return photos.flatMap((item) => {
    const kept = withPhotosWhere(item, (uri) => !uri.startsWith('data:'))
    return kept.images?.length ? [kept] : []
  })
}

/** The session's photo sends as last written, in this run or the one before. */
export function waitingPhotoSends(sessionKey: string): readonly MobileNativeChatPendingMessage[] | undefined {
  return waiting.get(sessionKey) ?? recent.get(sessionKey)
}

/** The previous run's recent sessions, before any chat opens. A missing or
 *  corrupt entry leaves each chat to wait for its own read, as before. */
export function hydrateWaitingPhotoSends(): Promise<void> {
  return recent.hydrate()
}

export function resetWaitingPhotoSendsForTests(): void {
  waiting.clear()
  recent.reset()
}
