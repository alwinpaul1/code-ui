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

import {
  DEFAULT_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES_STORAGE_KEY,
  loadNotificationCategories,
  notificationCategoryOf,
  parseNotificationCategories,
  resetNotificationCategoriesForTests,
  saveNotificationCategories
} from './notification-categories'
import { showLocalNotification } from './local-notification-scheduling'
import { NOTIFICATION_STATUS_ICONS } from './notification-status-icon'

// The Claude Android app's two Code notification toggles (tl8.java:1173-1521): "Code updates"
// (`nvm.CODE`, "Get notified when Code sessions have updates") and "Code permission requests"
// (`nvm.CODE_REQUIRES_ACTION`, "Get notified when Code sessions need your approval to use a
// tool"). Here each maps to a kind of notification the app already tells apart: a session that
// finished or rang its bell is an update; one that is waiting on an approval or an answer is a
// permission request.

describe('which toggle a notification belongs to', () => {
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

describe('keeping the two toggles', () => {
  beforeEach(async () => {
    resetNotificationCategoriesForTests()
    await AsyncStorage.removeItem(NOTIFICATION_CATEGORIES_STORAGE_KEY)
  })

  it('has both on until a reader turns one off', async () => {
    expect(DEFAULT_NOTIFICATION_CATEGORIES).toEqual({ updates: true, permissionRequests: true })
    expect(await loadNotificationCategories()).toEqual(DEFAULT_NOTIFICATION_CATEGORIES)
  })

  it('reads a value it does not know as on, field by field', () => {
    expect(parseNotificationCategories('{"updates":"no","permissionRequests":false}')).toEqual({
      updates: true,
      permissionRequests: false
    })
    expect(parseNotificationCategories('not json')).toEqual(DEFAULT_NOTIFICATION_CATEGORIES)
    expect(parseNotificationCategories(null)).toEqual(DEFAULT_NOTIFICATION_CATEGORIES)
  })

  it('keeps one toggle off across a restart and leaves the other on', async () => {
    await saveNotificationCategories({ updates: false })
    expect(await loadNotificationCategories()).toEqual({ updates: false, permissionRequests: true })
    await saveNotificationCategories({ permissionRequests: false })
    expect(await loadNotificationCategories()).toEqual({ updates: false, permissionRequests: false })
  })

  it('reads storage that cannot be read as both on: a notification is never lost to a storage fault', async () => {
    const original = AsyncStorage.getItem
    AsyncStorage.getItem = vi.fn().mockRejectedValue(new Error('locked'))
    try {
      expect(await loadNotificationCategories()).toEqual(DEFAULT_NOTIFICATION_CATEGORIES)
    } finally {
      AsyncStorage.getItem = original
    }
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

describe('a notification when a toggle is off', () => {
  beforeEach(async () => {
    scheduled.length = 0
    resetNotificationCategoriesForTests()
    await AsyncStorage.removeItem(NOTIFICATION_CATEGORIES_STORAGE_KEY)
  })

  it('shows a finished session while both are on', async () => {
    await showLocalNotification(event('Claude finished'), 'host-a')
    expect(scheduled).toHaveLength(1)
  })

  it('does not show a finished session when Code updates is off', async () => {
    await saveNotificationCategories({ updates: false })
    await showLocalNotification(event('Claude finished'), 'host-a')
    expect(scheduled).toHaveLength(0)
  })

  it('does not show a bell when Code updates is off', async () => {
    await saveNotificationCategories({ updates: false })
    await showLocalNotification(event('Claude', 'terminal-bell'), 'host-a')
    expect(scheduled).toHaveLength(0)
  })

  it('still shows a session that needs input when only Code updates is off', async () => {
    await saveNotificationCategories({ updates: false })
    await showLocalNotification(event('Claude needs input'), 'host-a')
    expect(scheduled).toHaveLength(1)
  })

  it('does not show a session that needs input when Code permission requests is off', async () => {
    await saveNotificationCategories({ permissionRequests: false })
    await showLocalNotification(event('Claude needs input'), 'host-a')
    expect(scheduled).toHaveLength(0)
  })

  it('still shows a finished session when only Code permission requests is off', async () => {
    await saveNotificationCategories({ permissionRequests: false })
    await showLocalNotification(event('Claude finished'), 'host-a')
    expect(scheduled).toHaveLength(1)
  })

  it('always shows the test notification the Settings screen can send', async () => {
    await saveNotificationCategories({ updates: false, permissionRequests: false })
    await showLocalNotification(event('Test notification', 'test'), 'host-a')
    expect(scheduled).toHaveLength(1)
  })

  it('shows it anyway when the toggles cannot be read', async () => {
    const original = AsyncStorage.getItem
    AsyncStorage.getItem = vi.fn().mockRejectedValue(new Error('locked'))
    try {
      await showLocalNotification(event('Claude finished'), 'host-a')
    } finally {
      AsyncStorage.getItem = original
    }
    expect(scheduled).toHaveLength(1)
  })

  // notification-delivery-ordering.test.ts: a storage read that never answers is a hazard the
  // delivery path already guards against, and the toggles must not reopen it.
  it('shows it when the read of the toggles never answers, after a short wait', async () => {
    const original = AsyncStorage.getItem
    AsyncStorage.getItem = vi.fn(() => new Promise<string | null>(() => {}))
    vi.useFakeTimers()
    try {
      const shown = showLocalNotification(event('Claude finished'), 'host-a')
      await vi.advanceTimersByTimeAsync(200)
      await shown
    } finally {
      vi.useRealTimers()
      AsyncStorage.getItem = original
    }
    expect(scheduled).toHaveLength(1)
  })

  it('holds a banner back by what the toggles said once they have been read, with no further read', async () => {
    await saveNotificationCategories({ updates: false })
    const original = AsyncStorage.getItem
    const read = vi.fn(async () => null)
    AsyncStorage.getItem = read
    try {
      await showLocalNotification(event('Claude finished'), 'host-a')
    } finally {
      AsyncStorage.getItem = original
    }
    expect(scheduled).toHaveLength(0)
    expect(read).not.toHaveBeenCalled()
  })
})
