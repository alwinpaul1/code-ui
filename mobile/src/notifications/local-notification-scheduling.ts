import * as Notifications from 'expo-notifications'
import { presentDesktopNotification } from './notification-presentation'
import { uniqueWorktreeLaunchAgent } from './worktree-launch-agents'
import { Platform } from 'react-native'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { buildLocalNotificationData, type DesktopNotificationSource } from './notification-routing'
import { ensureNotificationPermissions } from './notification-permissions'
import { peekLiveHostClient } from '../transport/live-host-clients'
import type { RpcClient } from '../transport/rpc-client'
import { decorateWithPrompt } from './permission-notification-decorate'
import { lookupPendingPrompt } from './permission-lookup'
import { ensurePermissionCategory } from './permission-notification-category'

export type NotificationEvent = {
  type: 'notification'
  source: DesktopNotificationSource
  title: string
  body: string
  worktreeId?: string
  notificationId?: string
  // Desktop-assigned seq for reconnect catch-up (#8129); optional since older runtimes may omit it.
  notificationSeq?: number
  // Counter lifetime the seq belongs to (#8591); absent on older runtimes.
  notificationEpoch?: string
}

export type DismissNotificationEvent = {
  type: 'dismiss'
  notificationId: string
  notificationSeq?: number
  notificationEpoch?: string
}

type ScheduledNotificationState = {
  identifier?: string
  pending?: Promise<string | null>
  dismissAfterSchedule?: boolean
}

const scheduledNotificationsByHostAndNotificationId = new Map<string, ScheduledNotificationState>()

// Why: keys never repeat and are only freed on desktop dismiss (which remote users often miss), so bound the map to stop unbounded growth.
const MAX_SCHEDULED_NOTIFICATIONS = 256
let maxScheduledNotifications = MAX_SCHEDULED_NOTIFICATIONS

function getStoredNotificationKey(hostId: string, notificationId: string): string {
  return `${encodeURIComponent(hostId)}:${encodeURIComponent(notificationId)}`
}

// Evict oldest settled entries (never mid-schedule); Map iteration is insertion order so the first match is oldest.
function boundScheduledNotifications(): void {
  while (scheduledNotificationsByHostAndNotificationId.size > maxScheduledNotifications) {
    let evicted = false
    for (const [key, state] of scheduledNotificationsByHostAndNotificationId) {
      if (!state.pending) {
        scheduledNotificationsByHostAndNotificationId.delete(key)
        evicted = true
        break
      }
    }
    if (!evicted) {
      break
    }
  }
}

/** Test-only: override the cap (pass no arg to restore the default). */
export function setScheduledNotificationsMaxForTests(max?: number): void {
  maxScheduledNotifications = max ?? MAX_SCHEDULED_NOTIFICATIONS
}

/** Android takes the channel from the TRIGGER, never from the content.
 *  `NotificationContentInput` has no `channelId` at all — a spread put one
 *  there and TypeScript allowed it because a spread skips excess-property
 *  checks, so it compiled and was silently dropped. With `trigger: null`,
 *  `BaseNotificationBuilder` logs "Couldn't get channel for the notifications -
 *  trigger is 'null'" and uses `expo_notifications_fallback_notification_channel`.
 *
 *  Measured on a Galaxy S23: every notification this app has ever posted landed
 *  on that fallback, on 0.2.56 AND on the build that first tried to fix this by
 *  awaiting the channel — the log line still said "trigger is 'null'", which is
 *  what tells the two causes apart.
 *
 *  A channel-aware trigger delivers immediately, exactly as `trigger: null`
 *  does; it is not a schedule. */
/** The channel every Android notification is posted to. Its id changes when
 *  a locked setting has to: Android fixes a channel's vibration, sound and
 *  importance the moment the channel exists, and a later create with the same
 *  id changes only its name. `orca-desktop` vibrated (`[0, 250]`); the user
 *  asked for silence (2026-09-21), so this is a new, silent channel and the
 *  old one is deleted on every install that has it. */
export const ANDROID_NOTIFICATION_CHANNEL_ID = 'orca-desktop-quiet'
/** Channels earlier builds created, deleted so their locked settings go with
 *  them. Android keeps a deleted channel's id reserved with its old settings,
 *  which is why a retired id is never reused. */
export const RETIRED_ANDROID_NOTIFICATION_CHANNEL_IDS = ['orca-desktop'] as const
const ANDROID_CHANNEL_TRIGGER = { channelId: ANDROID_NOTIFICATION_CHANNEL_ID } as const

export function notificationTrigger(): { channelId: string } | null {
  return Platform.OS === 'android' ? ANDROID_CHANNEL_TRIGGER : null
}

/** Secondary guard. Once the trigger names a channel, a channel that does not
 *  exist yet IS substituted for the fallback — a different branch, logged as
 *  "Channel '%s' doesn't exists". Memoised as one promise rather than a boolean
 *  so concurrent posts at startup share the single round trip to Android's
 *  NotificationManager instead of repeating it. */
let channelReady: Promise<void> | null = null

export function configureNotificationChannel(): void {
  void ensureNotificationChannel()
}

export function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return Promise.resolve()
  }
  channelReady ??= Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID, {
    name: 'Desktop Notifications',
    importance: Notifications.AndroidImportance.HIGH,
    enableVibrate: false,
    lightColor: '#6366f1'
  })
    .then(
      () => undefined,
      () => {
        // A channel that cannot be created is not a reason to lose the alert:
        // Android falls back on its own and the user still hears about the agent.
        // Left resolved so later posts do not retry on every notification.
        return undefined
      }
    )
    .then(async () => {
      // Best effort, after the new channel exists so no post lands between:
      // a channel that is already gone, or a build without the call, changes
      // nothing about whether the alert is delivered.
      for (const id of RETIRED_ANDROID_NOTIFICATION_CHANNEL_IDS) {
        await Notifications.deleteNotificationChannelAsync(id).catch(() => undefined)
      }
    })
  return channelReady
}

/** Test-only: the memo outlives a single test's hooks. */
export function resetNotificationChannelForTests(): void {
  channelReady = null
}

/** The one banner a session owns. A worktree is the grain the reader thinks in
 *  — one project, one thing to deal with — and the host is in the key because
 *  the same project can be open on two of them. */
function sessionBannerIdentifier(hostId: string, worktreeId: string | undefined): string {
  return `codeui:${hostId}:${worktreeId ?? 'host'}`
}

/** The link an event arrived on. Optional because the FCM path has none. */
export type LocalNotificationLink = { client?: RpcClient | null }

async function presentedNotificationContent(
  event: NotificationEvent,
  hostId: string,
  link: LocalNotificationLink
) {
  const content = {
    ...presentDesktopNotification({
      ...event,
      agent: uniqueWorktreeLaunchAgent(event.worktreeId)
    }),
    data: buildLocalNotificationData(event, hostId)
  }
  // Why here and not at the caller: every path that shows a banner goes through
  // this, and a permission ask arriving with the previous command's stdout as
  // its caption — or a question arriving as "Using AskUserQuestion" — was the
  // whole complaint. Returns `content` untouched whenever there is nothing
  // pending or the host cannot say, so the notification is never delayed into
  // uselessness by the lookup.
  //
  // Why the event's own client comes first: the lookup used to borrow the UI's
  // client alone, and with the app in the background the UI's relay is
  // suspended while the foreground service listens on a client of its own —
  // one the UI registry never sees. So exactly when a notification matters,
  // the lookup found no client, gave up, and the banner had no Approve or
  // Deny (a friend's phone, Windows host, 2026-09-18). The event arrived over
  // a link; that link is up by definition, and it is the one to ask on.
  return decorateWithPrompt(content, event, hostId, {
    resolveClient: (id) => link.client ?? peekLiveHostClient(id),
    lookup: lookupPendingPrompt,
    ensureCategory: ensurePermissionCategory
  })
}

export async function showLocalNotification(
  event: NotificationEvent,
  hostId: string,
  link: LocalNotificationLink = {}
): Promise<void> {
  const storedKey = event.notificationId
    ? getStoredNotificationKey(hostId, event.notificationId)
    : null

  if (!storedKey) {
    const enabled = await loadPushNotificationsEnabled()
    if (!enabled) {
      return
    }

    const granted = await ensureNotificationPermissions()
    if (!granted) {
      return
    }

    await ensureNotificationChannel()
    await Notifications.scheduleNotificationAsync({
      content: await presentedNotificationContent(event, hostId, link),
      trigger: notificationTrigger()
    })
    return
  }

  let state = scheduledNotificationsByHostAndNotificationId.get(storedKey)
  if (state?.pending) {
    return
  }
  if (!state) {
    state = {}
    scheduledNotificationsByHostAndNotificationId.set(storedKey, state)
  }
  const notificationState = state

  const pending = (async () => {
    const enabled = await loadPushNotificationsEnabled()
    if (!enabled) {
      return null
    }

    const granted = await ensureNotificationPermissions()
    if (!granted) {
      return null
    }

    if (notificationState.identifier) {
      await Notifications.dismissNotificationAsync(notificationState.identifier).catch(() => {})
      notificationState.identifier = undefined
    }

    await ensureNotificationChannel()
    return Notifications.scheduleNotificationAsync({
      // One banner per SESSION, carrying its latest word. Android adds a banner
      // per notification unless they share an identifier, in which case a newer
      // one replaces the older — and a session that spoke five times was five
      // banners to clear, four of them already dealt with (2026-09-15).
      //
      // Per session, not globally: two projects wanting attention are two
      // different things, and collapsing those would hide one of them.
      identifier: sessionBannerIdentifier(hostId, event.worktreeId),
      content: await presentedNotificationContent(event, hostId, link),
      trigger: notificationTrigger()
    })
  })()
  notificationState.pending = pending

  try {
    const scheduledIdentifier = await pending
    if (!scheduledIdentifier) {
      if (!notificationState.identifier) {
        scheduledNotificationsByHostAndNotificationId.delete(storedKey)
      }
      return
    }
    if (notificationState.dismissAfterSchedule) {
      notificationState.dismissAfterSchedule = false
      scheduledNotificationsByHostAndNotificationId.delete(storedKey)
      await Notifications.dismissNotificationAsync(scheduledIdentifier).catch(() => {})
      return
    }
    // This banner now OWNS the session identifier, so every earlier
    // notification that was showing on it is superseded. Leaving their records
    // pointing at it meant a late dismiss for one of them — the desk answering
    // the prompt from two notifications ago — called dismiss on the identifier
    // now carrying the newest word, and the reader never saw it. Forgetting the
    // identifier does not lose the dismiss: it falls through to
    // `dismissPresentedNotification`, which matches on the notification id and
    // so can only ever clear its own banner.
    forgetSupersededBanners(storedKey, scheduledIdentifier)
    notificationState.identifier = scheduledIdentifier
    boundScheduledNotifications()
  } finally {
    if (notificationState.pending === pending) {
      notificationState.pending = undefined
      notificationState.dismissAfterSchedule = false
    }
  }
}

/** Drop the identifier from every record except the one that just claimed it.
 *  Their banners no longer exist; only the newest notification is on screen. */
function forgetSupersededBanners(keepKey: string, identifier: string): void {
  for (const [key, state] of scheduledNotificationsByHostAndNotificationId) {
    if (key !== keepKey && state.identifier === identifier) {
      state.identifier = undefined
    }
  }
}

/** Clear a banner the OS is still showing that this process has no record of.
 *  Matched on the host AND the notification id: two hosts can raise the same
 *  id, and dismissing the wrong one hides a notification nobody has seen. */
async function dismissPresentedNotification(hostId: string, notificationId: string): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync().catch(() => [])
  for (const item of presented) {
    const data = item.request?.content?.data as
      | { hostId?: unknown; notificationId?: unknown }
      | undefined
    if (data?.hostId === hostId && data?.notificationId === notificationId) {
      // The identifier is the REQUEST's, not the notification's.
      await Notifications.dismissNotificationAsync(item.request.identifier).catch(() => {})
    }
  }
}

export async function dismissLocalNotification(
  event: DismissNotificationEvent,
  hostId: string
): Promise<void> {
  if (!event.notificationId) {
    return
  }
  const storedKey = getStoredNotificationKey(hostId, event.notificationId)
  const state = scheduledNotificationsByHostAndNotificationId.get(storedKey)
  if (!state) {
    // The record lives in memory; the banner lives in the OS, and the two do not
    // die together. Background delivery is the normal path, so the app
    // restarting between showing a notification and dismissing it is the common
    // case — and returning here left that banner in the tray for good, with
    // every later one stacking on top of something the user had already dealt
    // with (reported 2026-09-15).
    //
    // The OS knows what it is still showing and the payload carries the host and
    // notification id, so the identifier is recoverable without it.
    await dismissPresentedNotification(hostId, event.notificationId)
    return
  }
  if (state.pending) {
    // Why: dismiss can arrive while the OS is still scheduling; defer it so no stale banner survives.
    state.dismissAfterSchedule = true
    return
  }
  if (!state.identifier) {
    return
  }
  scheduledNotificationsByHostAndNotificationId.delete(storedKey)
  await Notifications.dismissNotificationAsync(state.identifier).catch(() => {})
}
