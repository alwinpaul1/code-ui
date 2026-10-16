import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const scheduled: { content: { title?: string; data?: unknown } }[] = []

vi.mock('react-native', () => ({ AppState: { currentState: 'background' }, Platform: { OS: 'android' } }))
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => {}),
  scheduleNotificationAsync: vi.fn(async (request: { content: { title?: string; data?: unknown } }) => {
    scheduled.push(request)
    return 'generated'
  }),
  dismissNotificationAsync: vi.fn(async () => {}),
  getAllScheduledNotificationsAsync: vi.fn(async () => []),
  getPresentedNotificationsAsync: vi.fn(async () => [])
}))
vi.mock('./notification-permissions', () => ({ ensureNotificationPermissions: vi.fn(async () => true) }))
vi.mock('../storage/preferences', () => ({ loadPushNotificationsEnabled: vi.fn(async () => true) }))

import { notificationCategoryOf } from './notification-categories'
import { showLocalNotification } from './local-notification-scheduling'
import { NOTIFICATION_STATUS_ICONS } from './notification-status-icon'

// The two Code notification toggles ("Code updates", "Code permission requests") were removed
// from the Notifications screen on 2026-10-16 at the user's request: Code notifications are always
// on, and "Agent notifications" is the one switch. The kind of a banner is still told apart,
// because the session Reply action is built for permission requests only.

const OLD_TOGGLES_KEY = 'orca:notificationCategories'

describe('which kind a notification is', () => {
  it('puts a finished session under Code updates', () => {
    expect(notificationCategoryOf({ data: { statusIcon: NOTIFICATION_STATUS_ICONS.done } })).toBe('updates')
  })

  it('puts a bell under Code updates', () => {
    expect(notificationCategoryOf({ data: { statusIcon: NOTIFICATION_STATUS_ICONS.bell } })).toBe('updates')
  })

  it('puts a banner with no icon under Code updates', () => {
    expect(notificationCategoryOf({ data: {} })).toBe('updates')
    expect(notificationCategoryOf({})).toBe('updates')
  })

  it('puts a session that needs input under Code permission requests, by its icon', () => {
    expect(notificationCategoryOf({ data: { statusIcon: NOTIFICATION_STATUS_ICONS.question } })).toBe(
      'permission-requests'
    )
  })

  it('puts a banner carrying a permission to answer under Code permission requests, whatever its icon', () => {
    expect(notificationCategoryOf({ data: { permissionKey: 'k', statusIcon: NOTIFICATION_STATUS_ICONS.done } })).toBe(
      'permission-requests'
    )
  })

  it('puts a banner carrying a question to answer under Code permission requests', () => {
    expect(notificationCategoryOf({ data: { questionKey: 'q' } })).toBe('permission-requests')
  })
})

function event(headline: string, source: 'agent-task-complete' | 'terminal-bell' | 'test' = 'agent-task-complete') {
  return {
    type: 'notification' as const,
    source,
    title: `repo / main - ${headline}`,
    body: '',
    worktreeId: 'wt-1',
    notificationId: `n-${Math.random()}`
  }
}

describe('Code notifications', () => {
  beforeEach(async () => {
    scheduled.length = 0
    // What an older build wrote when both Code toggles were switched off.
    await AsyncStorage.setItem(OLD_TOGGLES_KEY, JSON.stringify({ updates: false, permissionRequests: false }))
  })

  it('show a finished session even where an older build stored Code updates as off', async () => {
    await showLocalNotification(event('Claude finished'), 'host-a')
    expect(scheduled).toHaveLength(1)
  })

  it('show a bell even where an older build stored Code updates as off', async () => {
    await showLocalNotification(event('Claude', 'terminal-bell'), 'host-a')
    expect(scheduled).toHaveLength(1)
  })

  it('show a session that needs input even where an older build stored Code permission requests as off', async () => {
    await showLocalNotification(event('Claude needs input'), 'host-a')
    expect(scheduled).toHaveLength(1)
  })

  it('show with nothing stored', async () => {
    await AsyncStorage.removeItem(OLD_TOGGLES_KEY)
    await showLocalNotification(event('Claude finished'), 'host-a')
    expect(scheduled).toHaveLength(1)
  })
})
