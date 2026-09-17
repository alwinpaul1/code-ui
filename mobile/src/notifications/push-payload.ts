import type { DismissNotificationEvent, NotificationEvent } from './local-notification-scheduling'
import type { DesktopNotificationSource } from './notification-routing'

/**
 * A push turned back into the event the local notification path already renders.
 *
 * Why parse into the EXISTING event shape rather than render the push directly:
 * everything the banner has learned — one banner per session, the markdown-table
 * flattening, the routing data, the superseded-dismiss guard — lives behind
 * `showLocalNotification`. A second rendering path for pushes would have to
 * relearn all of it, and would drift the first time only one of them is fixed.
 */
export type ParsedPushPayload = {
  hostId: string
  event: NotificationEvent | DismissNotificationEvent
}

/**
 * The sources the desktop, the gateway and the phone agreed on
 * (`src/shared/mobile-push-contract.ts`), mapped onto what routing understands.
 *
 * `plugin` has no local equivalent: it routes to the same worktree screen as a
 * completed task, so it is carried as one rather than dropped.
 */
const SOURCE_BY_PUSH_SOURCE: Record<string, DesktopNotificationSource> = {
  'agent-task-complete': 'agent-task-complete',
  'terminal-bell': 'terminal-bell',
  plugin: 'agent-task-complete'
}

const DEFAULT_SOURCE: DesktopNotificationSource = 'agent-task-complete'

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * A seq from a transport that has no numbers.
 *
 * FCM's data block is a flat map of strings, so a seq crosses the wire as
 * `"42"`. Returning undefined for anything unreadable keeps a bad seq from
 * costing the reader the notification it was attached to, which is the right
 * trade — but be clear about what it costs. For the catch-up FETCH an absent
 * seq means asking for a little too much. For the DELIVERED-PUSH LOG it means
 * the notification cannot be reported at all, because the desktop matches on
 * the triple, so it comes back once as a duplicate banner. A banner twice beats
 * a banner never; it is not free.
 */
function readSeq(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * Read an FCM data payload, or null when it could not produce a banner worth
 * showing.
 *
 * Fail-closed on purpose, and only here: this runs in a background task with no
 * screen and no user, so a malformed payload has to become "no notification"
 * rather than an exception in a headless process or an empty banner the reader
 * cannot act on. Every rejection below is a payload that would have rendered
 * blank or been unroutable.
 */
export function parsePushPayload(payload: unknown): ParsedPushPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const data = payload as Record<string, unknown>
  // Why hostId is required: it keys the banner identifier, the routing target and
  // the delivered-push log. Without it the banner opens nothing and the next
  // catch-up cannot be told this push already landed.
  const hostId = readText(data.hostId)
  if (!hostId) {
    return null
  }
  const notificationId = readText(data.notificationId) ?? undefined
  const notificationSeq = readSeq(data.notificationSeq)
  const notificationEpoch = readText(data.notificationEpoch) ?? undefined

  if (data.t === 'dismiss') {
    if (!notificationId) {
      return null
    }
    return {
      hostId,
      event: {
        type: 'dismiss',
        notificationId,
        ...(notificationSeq !== undefined ? { notificationSeq } : {}),
        ...(notificationEpoch !== undefined ? { notificationEpoch } : {})
      }
    }
  }
  if (data.t !== 'notification') {
    return null
  }
  const title = readText(data.title)
  const body = readText(data.body)
  if (!title || !body) {
    return null
  }
  const source = typeof data.source === 'string' ? SOURCE_BY_PUSH_SOURCE[data.source] : undefined
  return {
    hostId,
    event: {
      type: 'notification',
      source: source ?? DEFAULT_SOURCE,
      title,
      body,
      ...(readText(data.worktreeId) ? { worktreeId: data.worktreeId as string } : {}),
      ...(notificationId !== undefined ? { notificationId } : {}),
      ...(notificationSeq !== undefined ? { notificationSeq } : {}),
      ...(notificationEpoch !== undefined ? { notificationEpoch } : {})
    }
  }
}
