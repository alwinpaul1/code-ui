import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { buildLocalNotificationData, type DesktopNotificationSource } from './notification-routing'
import { ensureNotificationPermissions } from './notification-permissions'

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
const ANDROID_CHANNEL_TRIGGER = { channelId: 'orca-desktop' } as const

function notificationTrigger(): { channelId: string } | null {
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
  channelReady ??= Notifications.setNotificationChannelAsync('orca-desktop', {
    name: 'Desktop Notifications',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250],
    lightColor: '#6366f1'
  }).then(
    () => undefined,
    () => {
      // A channel that cannot be created is not a reason to lose the alert:
      // Android falls back on its own and the user still hears about the agent.
      // Left resolved so later posts do not retry on every notification.
      return undefined
    }
  )
  return channelReady
}

/** Test-only: the memo outlives a single test's hooks. */
export function resetNotificationChannelForTests(): void {
  channelReady = null
}

export async function showLocalNotification(
  event: NotificationEvent,
  hostId: string
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
      content: {
        title: event.title,
        body: event.body,
        data: buildLocalNotificationData(event, hostId)
      },
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
      content: {
        title: event.title,
        body: event.body,
        data: buildLocalNotificationData(event, hostId)
      },
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
    notificationState.identifier = scheduledIdentifier
    boundScheduledNotifications()
  } finally {
    if (notificationState.pending === pending) {
      notificationState.pending = undefined
      notificationState.dismissAfterSchedule = false
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
