import type { DismissNotificationEvent, NotificationEvent } from './local-notification-scheduling'

/**
 * How a replayed notification reaches the shade.
 *
 * - 'show': a banner, as a live event would post one.
 * - 'quiet': a banner only if it carries an action. Never planned here; the
 *   catch-up turns 'show' into it while the app is open.
 * - 'silent': delivered, and nothing posted.
 * - 'retire': delivered, nothing posted, and the session's banner a previous
 *   process left in the tray is cleared, because the session's last word in
 *   this replay was dismissed at the desk.
 *
 * Every presentation moves the watermark and the seen-set past the event — a
 * 'silent' one once the event superseding it lands — because a replay's job is
 * to bring them up to date, and a banner is only part of that when it is still
 * news.
 */
export type ReplayPresentation = 'show' | 'quiet' | 'silent' | 'retire'

type ReplayEvent = NotificationEvent | DismissNotificationEvent

/** One event's plan. A 'silent' step names the event that supersedes it — its
 *  banner's last event in the batch — because it only counts as delivered once
 *  that one lands (see drainReplayBatch). */
export type ReplayStep = { presentation: ReplayPresentation; supersededBy: number | null }

/**
 * Decide, for each event of one catch-up batch, whether it may still pop.
 *
 * Why this exists (2026-09-23, the user: "after a long session all the old pop
 * ups come up which were resolved already"). A reconnect asks the desktop for
 * every event past the phone's watermark, and the desktop keeps up to 256. Each
 * was posted as a banner in turn:
 *
 * - A notification the desk had already dealt with came back with its own
 *   dismiss later in the SAME batch — acknowledging a pane dismisses every id
 *   the desk announced for it. It posted, popped, and was withdrawn a moment
 *   later: a popup for something already resolved.
 * - A session that spoke five times posted five banners, each replacing the one
 *   before on the session's identifier. Only the last was ever visible; the
 *   other four were popups for words the session had already moved past.
 *
 * So a notification with a later dismiss is silent, and so is every word of a
 * session but its last. Nothing is judged by age: an old notification with no
 * dismiss is one the desk has NOT acknowledged, and the catch-up is the only
 * way it reaches a phone whose socket Doze silenced (a first cut aged events
 * out after 10 minutes and dropped exactly those, and a desktop clock running
 * behind silenced fresh ones).
 *
 * "Supersedes" follows what really shares a banner. An event with a
 * notificationId posts on its session's identifier (sessionBannerIdentifier),
 * so any later one in the same worktree replaces it. An event without one — a
 * terminal bell, a plugin — posts a banner of its own, so only an exact repeat
 * of the same line supersedes it.
 *
 * Only the replay path is planned. A live event is news by definition.
 */
export function planReplayPresentation(events: readonly ReplayEvent[]): ReplayStep[] {
  // Walked newest-first, so "is there a later dismiss" and "does this banner
  // speak again later" are both one lookup in what was already seen.
  const dismissedLater = new Set<string>()
  // Each banner's last event in the batch, by index: what supersedes the rest.
  const lastOfBanner = new Map<string, number>()
  const plan: ReplayStep[] = Array.from({ length: events.length }, () => ({
    presentation: 'show',
    supersededBy: null
  }))
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    // The batch is the desktop's reply, typed by assertion. A malformed entry is
    // left to the delivery loop, which already quarantines on what it cannot show;
    // throwing here would drop the whole batch before that loop starts.
    if (typeof event !== 'object' || event === null) {
      continue
    }
    if (event.type === 'dismiss') {
      if (event.notificationId) {
        dismissedLater.add(event.notificationId)
      }
      continue
    }
    if (event.type !== 'notification') {
      continue
    }
    const banner = bannerKey(event)
    const last = lastOfBanner.get(banner)
    if (last !== undefined) {
      plan[index] = { presentation: 'silent', supersededBy: last }
      continue
    }
    lastOfBanner.set(banner, index)
    if (event.notificationId != null && dismissedLater.has(event.notificationId)) {
      plan[index] = { presentation: 'retire', supersededBy: null }
    }
  }
  return plan
}

/** Which banner an event would post on. */
function bannerKey(event: NotificationEvent): string {
  if (event.notificationId != null) {
    return `session\u0000${event.worktreeId ?? ''}`
  }
  return ['line', event.worktreeId ?? '', event.source, event.title, event.body].join('\u0000')
}
