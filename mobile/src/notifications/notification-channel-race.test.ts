import { beforeEach, expect, it, vi } from 'vitest'

type Scheduled = {
  contentChannelId?: unknown
  trigger: { channelId?: string } | null
}

const scheduled: Scheduled[] = []
const channelCalls: string[] = []
let resolveChannel: (() => void) | null = null

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: vi.fn(async (id: string) => {
    channelCalls.push(id)
    await new Promise<void>((resolve) => {
      resolveChannel = resolve
    })
  }),
  scheduleNotificationAsync: vi.fn(
    async (request: {
      content: Record<string, unknown>
      trigger: { channelId?: string } | null
    }) => {
      scheduled.push({ contentChannelId: request.content.channelId, trigger: request.trigger })
      return 'id'
    }
  ),
  dismissNotificationAsync: vi.fn(async () => {}),
  getAllScheduledNotificationsAsync: vi.fn(async () => [])
}))
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('../storage/preferences', () => ({ loadPushNotificationsEnabled: async () => true }))
vi.mock('./notification-permissions', () => ({ ensureNotificationPermissions: async () => true }))

import {
  configureNotificationChannel,
  resetNotificationChannelForTests,
  showLocalNotification
} from './local-notification-scheduling'

const event = {
  type: 'notification',
  source: 'agent-task-complete',
  title: 'NexOS / main',
  body: 'Claude finished'
} as const

beforeEach(() => {
  scheduled.length = 0
  channelCalls.length = 0
  resolveChannel = null
  resetNotificationChannelForTests()
})

it('names the channel on the trigger, which is the only place Android reads it', async () => {
  // The channel id was passed inside `content`, where expo never looks:
  // `NotificationContentInput` has no `channelId`, and a spread put one there
  // without TypeScript objecting, because a spread skips excess-property
  // checks. With no trigger, `BaseNotificationBuilder` logs "Couldn't get
  // channel for the notifications - trigger is 'null'" and substitutes
  // `expo_notifications_fallback_notification_channel`.
  //
  // Measured on a Galaxy S23 (logcat, pid 30537, build 0.2.57): that exact line
  // was still logged AFTER a first fix that only awaited the channel, which is
  // what proves the cause is the missing trigger and not a startup race.
  configureNotificationChannel()
  resolveChannel?.()
  await showLocalNotification(event, 'host-1')

  expect(scheduled).toHaveLength(1)
  expect(scheduled[0]!.trigger).toEqual({ channelId: 'orca-desktop' })
  // Anything left in content is dropped on the floor by expo.
  expect(scheduled[0]!.contentChannelId).toBeUndefined()
})

it('names the channel on the deduplicated path too', async () => {
  // The dismiss-aware path posts through its own call, so it regresses apart
  // from the plain one.
  configureNotificationChannel()
  resolveChannel?.()
  await showLocalNotification({ ...event, notificationId: 'n-1' }, 'host-1')

  expect(scheduled).toHaveLength(1)
  expect(scheduled[0]!.trigger).toEqual({ channelId: 'orca-desktop' })
  expect(scheduled[0]!.contentChannelId).toBeUndefined()
})

it('waits for the channel it is about to name', async () => {
  // Secondary guard: once the trigger names a channel, one that does not exist
  // YET is substituted for the fallback on a different branch ("Channel '%s'
  // doesn't exists"). Posting before the creation round trip finishes would
  // walk straight into it.
  configureNotificationChannel()
  const posting = showLocalNotification(event, 'host-1')
  for (let tick = 0; tick < 10; tick++) {
    await Promise.resolve()
  }
  expect(scheduled).toEqual([])

  resolveChannel?.()
  await posting
  expect(scheduled[0]!.trigger).toEqual({ channelId: 'orca-desktop' })
})

it('creates the channel once however many notifications arrive', async () => {
  configureNotificationChannel()
  configureNotificationChannel()
  const first = showLocalNotification(event, 'host-1')
  const second = showLocalNotification({ ...event, source: 'terminal-bell' }, 'host-1')
  resolveChannel?.()
  await Promise.all([first, second])
  expect(channelCalls).toEqual(['orca-desktop'])
  expect(scheduled.map((entry) => entry.trigger)).toEqual([
    { channelId: 'orca-desktop' },
    { channelId: 'orca-desktop' }
  ])
})

it('still posts when the channel call fails, rather than dropping the alert', async () => {
  // Not a regression test for the channel bug — it guards the failure mode the
  // await itself introduces. A channel that cannot be created is no reason to
  // lose the alert: Android falls back on its own and the user still hears
  // about the agent.
  const notifications = await import('expo-notifications')
  vi.mocked(notifications.setNotificationChannelAsync).mockRejectedValueOnce(new Error('nope'))
  configureNotificationChannel()
  await showLocalNotification(event, 'host-1')
  expect(scheduled).toHaveLength(1)
  expect(scheduled[0]!.trigger).toEqual({ channelId: 'orca-desktop' })
})
