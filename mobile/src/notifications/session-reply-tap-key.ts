/** What a typed reply is told by: the banner it came from and when this response was posted, and the
 *  words. */
export type SessionReplyTapKeyInput = {
  userText?: string | null
  notification: {
    /** When the system posted this response's notification, in ms. */
    date?: number
    request: { identifier: string; content: { data?: Record<string, unknown> | null } }
  }
}

/**
 * The key one typed reply is told by, so it is queued once.
 *
 * At a cold start the same response arrives twice, once from `getLastNotificationResponse` and once
 * from the listener (notification-routing.ts, `notificationTapKey`). A body tap is deduplicated by
 * its key and an answer to a prompt is idempotent (its re-check finds no prompt the second time),
 * but a reply is a message: queued twice, it is typed twice. The key is the banner (its identifier
 * and the desktop's notification id), the time the response was posted, and the words: the same
 * response is the same key, a reply typed a moment later is not, and neither are different words.
 */
export function sessionReplyTapKey(response: SessionReplyTapKeyInput): string {
  const { request, date } = response.notification
  const id: unknown = request.content.data?.notificationId
  return `reply:${request.identifier}@${typeof id === 'string' ? id : ''}@${date ?? ''}:${response.userText ?? ''}`
}
