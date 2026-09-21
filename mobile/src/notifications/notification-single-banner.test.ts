import { beforeEach, describe, expect, it, vi } from 'vitest'

const requests: { identifier?: string; content: { data?: unknown } }[] = []

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => {}),
  scheduleNotificationAsync: vi.fn(async (request: { identifier?: string; content: { data?: unknown } }) => {
    requests.push(request)
    return request.identifier ?? 'generated'
  }),
  dismissNotificationAsync: vi.fn(async () => {}),
  getAllScheduledNotificationsAsync: vi.fn(async () => []),
  getPresentedNotificationsAsync: vi.fn(async () => [])
}))
vi.mock('./notification-permissions', () => ({
  ensureNotificationPermissions: vi.fn(async () => true)
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn(async () => true)
}))

import { showLocalNotification } from './local-notification-scheduling'

function event(notificationId: string, worktreeId: string, body: string) {
  return {
    type: 'notification' as const,
    source: 'agent' as const,
    title: 'Claude',
    body,
    worktreeId,
    notificationId
  }
}

/**
 * 2026-09-15 from the phone: "multiple notifications are stacked… need to be
 * only the recent notification which was not acted upon".
 *
 * Android adds a banner per notification unless they share an identifier, in
 * which case a newer one REPLACES the older. One session's chatter is one
 * thing the reader has to deal with, not five, so a session gets one banner
 * carrying its latest word.
 *
 * Per SESSION, not globally: two projects both wanting attention are two
 * different things, and collapsing those would hide one of them.
 */
describe('a session that notifies more than once', () => {
  beforeEach(() => {
    requests.length = 0
  })

  it('replaces its own banner instead of stacking a second', async () => {
    await showLocalNotification(event('n-1', 'wt-a', 'first'), 'host-a')
    await showLocalNotification(event('n-2', 'wt-a', 'second'), 'host-a')
    expect(requests).toHaveLength(2)
    expect(requests[0]?.identifier).toBeTruthy()
    expect(requests[1]?.identifier).toBe(requests[0]?.identifier)
  })

  it('keeps a different project in its own banner', async () => {
    await showLocalNotification(event('n-1', 'wt-a', 'first'), 'host-a')
    await showLocalNotification(event('n-2', 'wt-b', 'other project'), 'host-a')
    expect(requests[1]?.identifier).not.toBe(requests[0]?.identifier)
  })

  it('keeps the same project on a different host apart', async () => {
    await showLocalNotification(event('n-1', 'wt-a', 'first'), 'host-a')
    await showLocalNotification(event('n-2', 'wt-a', 'first'), 'host-b')
    expect(requests[1]?.identifier).not.toBe(requests[0]?.identifier)
  })
})
