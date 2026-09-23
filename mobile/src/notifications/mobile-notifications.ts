import { AppState } from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
// Re-exported so the existing importers (and their vi.mock paths) keep working.
export {
  ensureNotificationPermissions,
  getNotificationPermissionState,
  type NotificationPermissionState
} from './notification-permissions'
export { setScheduledNotificationsMaxForTests } from './local-notification-scheduling'
import {
  configureNotificationChannel,
  dismissLocalNotification,
  retireSessionBanner,
  showLocalNotification,
  type DismissNotificationEvent,
  type NotificationEvent
} from './local-notification-scheduling'
import { planReplayPresentation, type ReplayPresentation } from './notification-replay-plan'
import { persistSeenKeys } from './notification-seen-store'
import {
  cachedDeliveredPushes,
  reportableDeliveredPushes,
  seedDeliveredPushes
} from './push-delivery-log'
import {
  adoptNotificationEpoch,
  catchUpWatermarkSeq,
  enqueueHostDelivery,
  getHostNotificationSession,
  quarantineCatchUpWatermark,
  releaseQueuedShowNotificationId,
  resolveCatchUpQuarantine,
  saveWatermark,
  seedWatermarkFromStorage,
  seenKeyForEvent,
  shouldQueueShowForNotificationId
} from './notification-reconnect-catchup'

type SubscribeResult = {
  type: 'ready'
  subscriptionId: string
  // Desktop counter lifetime (#8591); absent from runtimes that predate it.
  epoch?: string
}

// Per-connection subscription; a reconnect `ready` triggers watermarked catch-up (#8129) so already-pushed events aren't re-sent.
/** How long after a foregrounding the app still counts as open. React Native
 *  on Android can report 'background' for the first moments of a cold start,
 *  before the first state event lands — which is when the reconnect replay
 *  runs (phone, 2026-09-21: three old banners within 13 s of a cold open, on
 *  a build that read the field alone). Longer than a relay dial and a replay;
 *  shorter than a real background stint. */
const FOREGROUND_GRACE_MS = 15_000

let foregroundedAt: number | null = AppState.currentState === 'active' ? Date.now() : null
AppState.addEventListener?.('change', (state) => {
  if (state === 'active') {
    foregroundedAt = Date.now()
  }
})

/** Whether the user is looking at the app: the state field says so, or the
 *  app came to the foreground within the grace. A headless start (the
 *  foreground service after a reboot) never foregrounds, so it stays false. */
function appIsOpen(): boolean {
  if (AppState.currentState === 'active') {
    return true
  }
  return foregroundedAt !== null && Date.now() - foregroundedAt < FOREGROUND_GRACE_MS
}

export function subscribeToDesktopNotifications(client: RpcClient, hostId: string): () => void {
  configureNotificationChannel()

  let subscriptionId: string | null = null
  let disposed = false
  // Why (#8591): survives the unsubscribe/resubscribe the app performs on every
  // socket drop, so a reconnect still knows its watermark and that it reconnected.
  const session = getHostNotificationSession(hostId)

  /**
   * Queue one delivery on the host chain, dropping a show whose notificationId
   * already has one queued.
   *
   * Why the claim is taken HERE and not inside deliverLive (#8591): the point of
   * the dedup is to notice a second event arriving while the first is still
   * outstanding. Inside the queued task the first has already finished, so the
   * overlap is no longer observable — it has to be checked before enqueueing.
   */
  function queueDelivery(
    type: 'notification' | 'dismiss',
    event: NotificationEvent | DismissNotificationEvent
  ): Promise<void> {
    if (
      type === 'notification' &&
      !shouldQueueShowForNotificationId(session, event.notificationId)
    ) {
      return Promise.resolve()
    }
    return enqueueHostDelivery(session, async () => {
      try {
        await deliverLive(type, event)
      } finally {
        if (type === 'notification') {
          releaseQueuedShowNotificationId(session, event.notificationId)
        }
      }
      // Why swallowed: the caller is an un-awaited handler, so a rejected show would
      // surface as an unhandled rejection (a RN redbox) instead of being retried by
      // the next catch-up — which is now possible, since `seen` is marked after the show.
    }).catch(() => {})
  }

  async function deliverLive(
    type: 'notification' | 'dismiss',
    event: NotificationEvent | DismissNotificationEvent,
    presentation: ReplayPresentation = 'show'
  ): Promise<void> {
    adoptNotificationEpoch(session, hostId, event.notificationEpoch)
    const epochAtDelivery = session.lastDeliveredEpoch
    if (type === 'notification') {
      // 'silent' and 'retire' still fall through to the seen-set and the watermark
      // below: the event was delivered, it is simply not news any more.
      if (presentation === 'retire') {
        await retireSessionBanner(hostId, (event as NotificationEvent).worktreeId)
      } else if (presentation !== 'silent') {
        // The link this event came over is the one to ask about it on; see
        // presentedNotificationContent.
        await showLocalNotification(event as NotificationEvent, hostId, {
          client,
          quietUnlessActionable: presentation === 'quiet'
        })
      }
    } else {
      await dismissLocalNotification(event as DismissNotificationEvent, hostId)
    }
    // Why after the await, exactly like the watermark below: `seen` asserts this event
    // reached the user (#8129). Marked before, a rejected show leaves the key behind and
    // every later replay is dropped as a duplicate — loss the quarantine cannot recover,
    // since the first event to drain a batch lifts it past the one never shown.
    const key = seenKeyForEvent(event)
    // A mid-flight epoch adoption already cleared the counter lifetime this key indexes.
    if (key && session.lastDeliveredEpoch === epochAtDelivery) {
      session.seen.add(key)
      // Kept across a restart, so a replay from a lagging watermark recognises
      // what this run already showed (notification-seen-store.ts). Without an
      // epoch the keys cannot be tied to a counter, so they stay in memory.
      if (session.lastDeliveredEpoch !== null) {
        persistSeenKeys(hostId, session.lastDeliveredEpoch, session.seen.keys())
      }
    }
    advanceWatermark(event)
  }

  function advanceWatermark(event: NotificationEvent | DismissNotificationEvent): void {
    // Why after the await (#8591): the watermark is a promise that everything up
    // to this seq has been shown. Advancing it before the local notification lands
    // means a process death in between silently drops it — the next launch asks the
    // desktop for seq greater than one the user never saw.
    if (event.notificationSeq != null && event.notificationSeq > session.lastDeliveredSeq) {
      session.lastDeliveredSeq = event.notificationSeq
      // Why clamped: while a failed catch-up's range is still unrecovered, persisting
      // the live seq would let the next catch-up ask from above the gap and the desktop
      // would cut it. resolveCatchUpQuarantine writes the held-back value on success.
      void saveWatermark(hostId, {
        seq: catchUpWatermarkSeq(session),
        epoch: session.lastDeliveredEpoch
      })
    }
  }

  // Claimed inline rather than via queueDelivery: the batch is already one queue
  // entry, and re-enqueueing per item is what let a live event cut in.
  async function deliverMissedEvent(
    event: NotificationEvent | DismissNotificationEvent,
    presentation: ReplayPresentation
  ): Promise<void> {
    // No pre-marking here either: deliverLive marks the key once the show lands.
    const key = seenKeyForEvent(event)
    if (key && session.seen.has(key)) {
      // Shown already, by this run or (through the stored keys) the one before a
      // restart. It still counts as delivered: left behind, a restart after a
      // lagging watermark would ask from below it again every time.
      if (event.notificationEpoch == null || event.notificationEpoch === session.lastDeliveredEpoch) {
        advanceWatermark(event)
      }
      return
    }
    if (event.type === 'notification') {
      if (!shouldQueueShowForNotificationId(session, event.notificationId)) {
        return
      }
      try {
        await deliverLive('notification', event, presentation)
      } finally {
        releaseQueuedShowNotificationId(session, event.notificationId)
      }
      return
    }
    if (event.type === 'dismiss') {
      await deliverLive('dismiss', event)
    }
  }

  // Why: desktop cuts by seq > lastSeenSeq, so re-fetching from the watermark is idempotent (session.seen guards residual overlap).
  async function fetchMissed(): Promise<void> {
    if (disposed) {
      return
    }
    // Captured before the request: everything at or below it is known delivered, so
    // it is the floor the watermark falls back to if this catch-up never completes.
    const askFrom = catchUpWatermarkSeq(session)
    // Why: a push shown while the app was dead left no trace the desktop can see,
    // so without naming those notifications the replay shows every one of them a
    // second time. Pruned to the ones the seq cut does not already cover.
    // Read from memory on purpose: awaiting storage here would put the catch-up
    // behind a read that can hang, and a late catch-up loses notifications while
    // an unreported push only repeats one.
    const deliveredPushes = reportableDeliveredPushes(
      cachedDeliveredPushes(hostId),
      session.lastDeliveredEpoch,
      askFrom
    )
    const missed = await client
      .sendRequest('notifications.getMissedSince', {
        lastSeenSeq: askFrom,
        // Why: sending the epoch lets the desktop reject a watermark from a counter
        // it no longer has and return the whole retained buffer instead of nothing.
        ...(session.lastDeliveredEpoch != null ? { epoch: session.lastDeliveredEpoch } : {}),
        ...(deliveredPushes.length > 0 ? { deliveredPushes } : {})
      })
      .then((response) => {
        if (!response.ok) {
          return null
        }
        const result = response.result as { notifications?: unknown[]; epoch?: string } | undefined
        adoptNotificationEpoch(session, hostId, result?.epoch)
        return Array.isArray(result?.notifications) ? result.notifications : []
      })
      .catch(() => null)
    if (missed == null) {
      // Why quarantine rather than retry: the range this catch-up abandoned stays
      // unrecovered until SOME later one succeeds, and a live seq persisting past it
      // meanwhile would make the desktop cut it forever.
      quarantineCatchUpWatermark(session, hostId, askFrom)
      return
    }
    // Why the whole batch is ONE queue entry (#8591): awaiting per event returns to
    // the event loop between replays, so a live seq 11 slots into the chain between
    // seq 6 and 7 and persists a watermark past a notification still unshown. Why the
    // request stays OUTSIDE the queue: sendRequest waits up to 30s, and holding the
    // chain for that would stall live delivery on a slow link.
    await enqueueHostDelivery(session, async () => {
      // A replay drained while the app is open posts nothing the open screen
      // already shows ("when I open the app suddenly all the notifications come
      // up", 2026-09-21): the socket died in the background, the reconnect came
      // with the open, and every missed event became a banner over the app.
      // Read per event, not per batch: a user who opens the app and leaves it
      // again while the replay drains must get the rest as banners, or they
      // are silenced for good (the watermark moves past them). Only 'active'
      // is quiet; 'unknown' at a cold start shows, the safe side. A replay
      // while the app is still in the background still shows what is news.
      //
      // And only what is still news pops at all: a notification dismissed later
      // in the batch and a session's superseded words are delivered without a
      // banner (see planReplayPresentation). Planned once over the whole batch,
      // because both are facts about events after this one.
      const plan = planReplayPresentation(missed as (NotificationEvent | DismissNotificationEvent)[])
      const presentationAt = (index: number): ReplayPresentation => {
        const planned = plan[index] ?? 'show'
        return planned === 'show' && appIsOpen() ? 'quiet' : planned
      }
      // Advances only past events this batch settled, so a teardown or a failing show
      // quarantines the true contiguous point instead of the range it never reached.
      let contiguousSeq = askFrom
      let drained = false
      try {
        for (const [index, raw] of missed.entries()) {
          // Re-checked per event: the batch can start before a teardown and still be
          // draining after it, and a torn-down host must stop pushing.
          if (disposed) {
            return
          }
          const event = raw as NotificationEvent | DismissNotificationEvent
          await deliverMissedEvent(event, presentationAt(index))
          contiguousSeq = event.notificationSeq ?? contiguousSeq
        }
        drained = true
      } finally {
        if (drained) {
          resolveCatchUpQuarantine(session, hostId)
        } else {
          quarantineCatchUpWatermark(session, hostId, contiguousSeq)
        }
      }
      // Why swallowed here: the `finally` above already recorded the contiguous point,
      // and the only caller is an un-awaited 'ready' continuation — letting a failed
      // show escape turns every one into an unhandled rejection (a RN redbox).
    }).catch(() => {})
  }

  seedWatermarkFromStorage(session, hostId)
  // Warmed here, well before the first 'ready', so the catch-up never waits on it.
  void seedDeliveredPushes(hostId)

  function unsubscribeServer(id: string) {
    if (client.getState() === 'connected') {
      client.sendRequest('notifications.unsubscribe', { subscriptionId: id }).catch(() => {})
    }
  }

  const unsubscribeStream = client.subscribe('notifications.subscribe', {}, (data: unknown) => {
    const event = data as
      | NotificationEvent
      | DismissNotificationEvent
      | SubscribeResult
      | { type: 'end' }
    // No dispose-before-ready arm: every transport detaches this listener inside
    // `unsubscribeStream()`, so a callback that runs at all runs before disposal.
    if (event.type === 'ready') {
      subscriptionId = (event as SubscribeResult).subscriptionId
      const isReconnect = session.connectedBefore
      session.connectedBefore = true
      const readyEpoch = (event as SubscribeResult).epoch
      // Why (#8591) the await: on a cold app open the persisted read is still in
      // flight, so deciding here would see watermarkLoaded false and skip catch-up —
      // which is precisely the post-upgrade / post-process-death case that loses
      // every notification between the stored watermark and the next live seq.
      void (async () => {
        await session.watermarkSeeded
        if (disposed) {
          return
        }
        // Why before fetchMissed: adopting the epoch here is what voids a watermark
        // left over from a previous desktop lifetime, so the catch-up request carries
        // a watermark that means something against the counter now answering it.
        adoptNotificationEpoch(session, hostId, readyEpoch)
        // A reconnect always catches up. A cold open catches up only when this device
        // has delivered for this host before — a first-ever pairing must not be handed
        // the desktop's whole retained buffer.
        if (isReconnect || session.hadStoredWatermark) {
          await fetchMissed()
        }
      })()
      return
    }
    if (event.type === 'end') {
      if (disposed) {
        unsubscribeStream()
      }
      return
    }
    if (disposed) {
      return
    }
    if (event.type !== 'notification' && event.type !== 'dismiss') {
      return
    }
    // Why the await (#8591): deliverLive advances the watermark. A live event landing
    // while the persisted read is still in flight would push it past the buffered seqs
    // the catch-up is about to ask for, and getMissedSince would cut them. Ordering is
    // preserved — every handler waits on the same promise, and the 'ready' continuation
    // registered on it first, so catch-up still builds its request before any live seq.
    const liveEvent = event
    void (async () => {
      await session.watermarkSeeded
      if (disposed) {
        return
      }
      // Why the queue (#8591): a live event must not overtake an in-flight
      // catch-up replay, or it persists a watermark past seqs still unshown.
      await queueDelivery(
        liveEvent.type === 'notification' ? 'notification' : 'dismiss',
        liveEvent as NotificationEvent | DismissNotificationEvent
      )
    })()
  })

  return () => {
    disposed = true
    // Why: drop the local stream first — readiness can race unmount; don't hold the callback while a subscription id is pending.
    unsubscribeStream()
    if (subscriptionId) {
      unsubscribeServer(subscriptionId)
    }
  }
}
