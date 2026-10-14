import { beforeEach, expect, it, vi } from 'vitest'

// The Claude Android app's Code channel (jsm.java:30-33, 1.261009.20): id `bogosort`, name
// "Code sessions" (notification_channel_code_name), importance 4 (HIGH), badge on, description
// "Notifying you when Claude has finished working on your code". The channel's NAME is what the
// system's notification settings list, so it says what the notifications are: sessions, not
// "Desktop Notifications". Android fixes a channel's vibration, sound and importance when it is
// created (notification-channel-vibration.test.ts), but a later create under the same id changes
// the name, which is all this changes: the id stays, so no install loses its channel settings.
const created: { id: string; options: Record<string, unknown> }[] = []

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: vi.fn(async (id: string, options: Record<string, unknown>) => {
    created.push({ id, options })
  }),
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  scheduleNotificationAsync: vi.fn(async () => 'id'),
  dismissNotificationAsync: vi.fn(async () => {}),
  getAllScheduledNotificationsAsync: vi.fn(async () => [])
}))
vi.mock('react-native', () => ({ AppState: { currentState: 'background' }, Platform: { OS: 'android' } }))
vi.mock('../storage/preferences', () => ({ loadPushNotificationsEnabled: async () => true }))
vi.mock('./notification-permissions', () => ({ ensureNotificationPermissions: async () => true }))

import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  ensureNotificationChannel,
  resetNotificationChannelForTests
} from './local-notification-scheduling'

beforeEach(() => {
  created.length = 0
  resetNotificationChannelForTests()
})

it('names the channel "Code sessions", as the Claude app does', async () => {
  await ensureNotificationChannel()
  expect(created[0]!.options.name).toBe('Code sessions')
})

it('keeps its id, so a phone that already has the channel keeps its settings', async () => {
  await ensureNotificationChannel()
  expect(created[0]!.id).toBe(ANDROID_NOTIFICATION_CHANNEL_ID)
  expect(created[0]!.id).toBe('orca-desktop-lockscreen')
})

it('is still high importance, with the badge on, and describes what it is for', async () => {
  await ensureNotificationChannel()
  expect(created[0]!.options).toMatchObject({
    importance: 4,
    showBadge: true,
    description: 'Notifying you when an agent has finished working on your code'
  })
})
