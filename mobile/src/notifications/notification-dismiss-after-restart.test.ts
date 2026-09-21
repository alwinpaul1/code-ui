import { beforeEach, describe, expect, it, vi } from 'vitest'

const dismissed: string[] = []
// The shape expo-notifications really returns: the identifier belongs to the
// REQUEST. My first fixture put it on the notification and only tsc noticed —
// an invented fixture agrees with an invented reader and both stay wrong.
let presented: { request: { identifier: string; content: { data?: unknown } } }[] = []

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => {}),
  scheduleNotificationAsync: vi.fn(async () => 'fresh-id'),
  dismissNotificationAsync: vi.fn(async (id: string) => {
    dismissed.push(id)
  }),
  getAllScheduledNotificationsAsync: vi.fn(async () => []),
  getPresentedNotificationsAsync: vi.fn(async () => presented)
}))
vi.mock('./notification-permissions', () => ({
  ensureNotificationPermissions: vi.fn(async () => true)
}))

import { dismissLocalNotification } from './local-notification-scheduling'

/**
 * 2026-09-15 from the phone: notifications stack up and the ones already dealt
 * with never go away.
 *
 * The dismiss path resolved the tray identifier from a module-level Map. That
 * Map does not survive the process, but the Android tray notification does —
 * and background delivery is the normal path, so the app restarting between
 * showing a notification and dismissing it is the common case, not a corner.
 * On a miss it returned silently and the banner was stranded for good, so every
 * new one piled on top of banners that could never leave.
 *
 * The OS knows what it is still showing, and the payload already carries the
 * host and notification id, so a miss is recoverable rather than terminal.
 */
describe('dismissing a notification after the app has restarted', () => {
  beforeEach(() => {
    dismissed.length = 0
    presented = []
  })

  it('still clears the banner when the in-memory record is gone', async () => {
    // What the OS is showing, from before the restart.
    presented = [
      { request: { identifier: 'tray-1', content: { data: { hostId: 'host-a', notificationId: 'n-1' } } } }
    ]
    await dismissLocalNotification({ type: 'dismissNotification', notificationId: 'n-1' }, 'host-a')
    expect(dismissed).toEqual(['tray-1'])
  })

  it('leaves a banner belonging to another host alone', async () => {
    presented = [
      { request: { identifier: 'tray-other', content: { data: { hostId: 'host-b', notificationId: 'n-1' } } } }
    ]
    await dismissLocalNotification({ type: 'dismissNotification', notificationId: 'n-1' }, 'host-a')
    expect(dismissed).toEqual([])
  })

  it('does nothing when the OS is showing nothing for it', async () => {
    await dismissLocalNotification({ type: 'dismissNotification', notificationId: 'n-9' }, 'host-a')
    expect(dismissed).toEqual([])
  })
})
