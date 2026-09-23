import type { DismissNotificationEvent, NotificationEvent } from './local-notification-scheduling'

/**
 * How a replayed notification reaches the shade.
 *
 * - 'show': a banner, as a live event would post one.
 * - 'quiet': a banner only if it carries an action, i.e. the host says the agent
 *   is paused on a prompt right now. Anything else counts as delivered, silently.
 * - 'silent': counts as delivered, and no banner at all.
 *
 * Every presentation moves the watermark past the event: a replay's job is to
 * bring it up to date, and a banner is only part of that when it is still news.
 */
export type ReplayPresentation = 'show' | 'quiet' | 'silent'

/** Past this, a replayed notification is not news. Measured against the
 *  desktop's `emittedAt`, which stock Orca stamps on every agent notification
 *  it sends to a phone. A replay only happens after the link was down, so
 *  anything older than this was missed long enough ago that the user has
 *  likely dealt with it at the desk already. */
export const REPLAY_STALE_AFTER_MS = 10 * 60_000

type ReplayEvent = NotificationEvent | DismissNotificationEvent

/**
 * Decide, for each event of one catch-up batch, whether it may still pop.
 *
 * Why this exists (2026-09-23, the user: "after a long session all the old pop
 * ups come up which were resolved already"). A reconnect asks the desktop for
 * every event past the phone's watermark, and the desktop keeps up to 256. Each
 * was posted as a banner in turn, so a restart after a long session replayed the
 * whole session into the shade, one heads-up at a time:
 *
 * - A notification the desk had already dealt with came back with its own
 *   dismiss later in the SAME batch. It posted, popped, and was withdrawn a
 *   moment later: a popup for something already resolved.
 * - A session that spoke five times posted five banners, each replacing the
 *   one before on the session's identifier. Only the last was ever visible;
 *   the other four were popups for words the session had already moved past.
 * - A notification from an hour ago posted as if it had just happened.
 *
 * So: a notification with a later dismiss is silent, every notification but the
 * last of its session is silent, and one older than REPLAY_STALE_AFTER_MS is
 * quiet — it still pops if the agent is waiting on a prompt now, because an
 * unanswered ask is not stale however old the event that announced it.
 * Dismisses always run: they retire banners a previous process left in the tray.
 *
 * Only the replay path is planned. A live event is news by definition.
 */
export function planReplayPresentation(
  events: readonly ReplayEvent[],
  now: number,
  staleAfterMs: number = REPLAY_STALE_AFTER_MS
): ReplayPresentation[] {
  // Walked newest-first, so "is there a later dismiss" and "is there a later
  // notification for this session" are both one lookup in what was already seen.
  const dismissedLater = new Set<string>()
  const sessionsSpokenLater = new Set<string>()
  const plan: ReplayPresentation[] = Array.from({ length: events.length }, () => 'show')
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
    // Keyed as the banner is (sessionBannerIdentifier): one per worktree, and a
    // host-level notification is its own session.
    const session = event.worktreeId ?? ''
    const superseded = sessionsSpokenLater.has(session)
    sessionsSpokenLater.add(session)
    if (superseded || (event.notificationId != null && dismissedLater.has(event.notificationId))) {
      plan[index] = 'silent'
      continue
    }
    if (isStale(event.emittedAt, now, staleAfterMs)) {
      plan[index] = 'quiet'
    }
  }
  return plan
}

/** Unknown age is not stale: a desktop that predates `emittedAt` keeps the
 *  behaviour it had, rather than losing every replayed banner. */
function isStale(emittedAt: unknown, now: number, staleAfterMs: number): boolean {
  if (typeof emittedAt !== 'number' || !Number.isFinite(emittedAt)) {
    return false
  }
  return now - emittedAt > staleAfterMs
}
