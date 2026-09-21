import { beforeEach, expect, it, vi } from 'vitest'

// 2026-09-21, the user: "stop the vibrations for notifications". The channel
// was created with `vibrationPattern: [0, 250]`, and Android locks a channel's
// vibration, sound and importance the moment it exists — a later
// setNotificationChannelAsync with the same id changes none of them, only its
// name. So turning vibration off is a NEW channel id created silent, and the
// old channel deleted so its settings die with it, on every install that
// already has it.
const created: { id: string; options: Record<string, unknown> }[] = []
const deleted: string[] = []

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: vi.fn(async (id: string, options: Record<string, unknown>) => {
    created.push({ id, options })
  }),
  deleteNotificationChannelAsync: vi.fn(async (id: string) => {
    deleted.push(id)
  }),
  scheduleNotificationAsync: vi.fn(async () => 'id'),
  dismissNotificationAsync: vi.fn(async () => {}),
  getAllScheduledNotificationsAsync: vi.fn(async () => [])
}))
vi.mock('react-native', () => ({ AppState: { currentState: 'background' }, Platform: { OS: 'android' } }))
vi.mock('../storage/preferences', () => ({ loadPushNotificationsEnabled: async () => true }))
vi.mock('./notification-permissions', () => ({ ensureNotificationPermissions: async () => true }))

import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  RETIRED_ANDROID_NOTIFICATION_CHANNEL_IDS,
  ensureNotificationChannel
} from './local-notification-scheduling'

beforeEach(async () => {
  created.length = 0
  deleted.length = 0
  const { resetNotificationChannelForTests } = await import('./local-notification-scheduling')
  resetNotificationChannelForTests()
})

it('creates a channel that never vibrates, under an id the vibrating channel never had', async () => {
  await ensureNotificationChannel()
  expect(created).toHaveLength(1)
  const [channel] = created
  expect(channel!.id).toBe(ANDROID_NOTIFICATION_CHANNEL_ID)
  expect(channel!.id).not.toBe('orca-desktop')
  expect(channel!.options.enableVibrate).toBe(false)
  expect(channel!.options.vibrationPattern).toBeUndefined()
  expect(channel!.options.importance).toBe(4)
})

it('deletes the vibrating channel every install already has, so its locked settings go with it', async () => {
  await ensureNotificationChannel()
  expect(RETIRED_ANDROID_NOTIFICATION_CHANNEL_IDS).toContain('orca-desktop')
  expect(deleted).toEqual([...RETIRED_ANDROID_NOTIFICATION_CHANNEL_IDS])
})

it('still resolves when the old channel cannot be deleted', async () => {
  const notifications = await import('expo-notifications')
  vi.mocked(notifications.deleteNotificationChannelAsync).mockRejectedValueOnce(new Error('no such channel'))
  await expect(ensureNotificationChannel()).resolves.toBeUndefined()
  expect(created).toHaveLength(1)
})
