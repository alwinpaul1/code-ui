import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NOTIFICATION_CATEGORIES_STORAGE_KEY,
  notificationCategoriesForBanner,
  resetNotificationCategoriesForTests,
  saveNotificationCategories
} from './notification-categories'

beforeEach(async () => {
  resetNotificationCategoriesForTests()
  await AsyncStorage.removeItem(NOTIFICATION_CATEGORIES_STORAGE_KEY)
})

// The Settings screen puts a toggle back to what storage holds when the write is refused. A banner
// must be held to the same thing: a copy in memory that kept the refused value would silence
// notifications the screen says are on.
describe('a toggle whose write was refused', () => {
  it('holds banners to what storage holds, not to the value that was refused', async () => {
    await saveNotificationCategories({ updates: true })
    const original = AsyncStorage.setItem
    AsyncStorage.setItem = vi.fn().mockRejectedValue(new Error('disk full'))
    try {
      await saveNotificationCategories({ updates: false }).catch(() => undefined)
    } finally {
      AsyncStorage.setItem = original
    }
    expect((await notificationCategoriesForBanner()).updates).toBe(true)
  })
})

describe('the first read a banner waits for', () => {
  it('leaves no timer running once the read has answered', async () => {
    vi.useFakeTimers()
    try {
      const shown = notificationCategoriesForBanner()
      await vi.advanceTimersByTimeAsync(0)
      await shown
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

// Changing one toggle writes the whole record. If storage cannot be read at that moment, the other
// toggle must keep what the phone last knew, not fall back to on: that would turn a toggle the reader
// switched off back on without a word.
describe('a toggle changed while storage cannot be read', () => {
  it('leaves the other toggle as the phone last knew it, not as the default', async () => {
    await saveNotificationCategories({ updates: false })
    const original = AsyncStorage.getItem
    AsyncStorage.getItem = vi.fn().mockRejectedValue(new Error('locked'))
    try {
      await saveNotificationCategories({ permissionRequests: false })
    } finally {
      AsyncStorage.getItem = original
    }
    const stored = JSON.parse((await AsyncStorage.getItem(NOTIFICATION_CATEGORIES_STORAGE_KEY)) ?? '{}') as Record<string, unknown>
    expect(stored).toEqual({ updates: false, permissionRequests: false })
  })
})
