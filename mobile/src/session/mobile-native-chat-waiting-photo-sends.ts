import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

/**
 * The phone's photo sends still waiting for their rows, per session, as the
 * draft store last wrote them in this run.
 *
 * The store reads its sends back from storage in an effect after a chat comes
 * back, and the kept transcript is painted before that. So a photo whose row
 * landed while its chat was away (queued mid-turn, dequeued at the end of the
 * turn while the user was in another project) was drawn from the row alone,
 * as "Image on Desktop", until the read came back (review, 2026-09-26). The
 * chat binds the photos from here until then (previewsAsDrawn). `data:`
 * previews are held too: storage leaves them out for its size cap, and nothing
 * caps them here but the number of sessions, as many as the draft store keeps
 * previews for.
 */
const RUN_SESSIONS = 8
const waiting = new Map<string, MobileNativeChatPendingMessage[]>()

/** What the store just wrote for a session; its photo sends are kept. */
export function rememberWaitingPhotoSends(
  sessionKey: string,
  pending: readonly MobileNativeChatPendingMessage[]
): void {
  const photos = pending.filter((item) => item.images?.length)
  waiting.delete(sessionKey)
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

/** The session's photo sends as last written in this run, if any. */
export function waitingPhotoSends(sessionKey: string): readonly MobileNativeChatPendingMessage[] | undefined {
  return waiting.get(sessionKey)
}

export function resetWaitingPhotoSendsForTests(): void {
  waiting.clear()
}
