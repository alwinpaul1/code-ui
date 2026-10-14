import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_READING_STORAGE_KEY,
  loadChatReadingSettings,
  resetChatReadingSettingsForTests
} from './chat-reading-settings'

beforeEach(async () => {
  resetChatReadingSettingsForTests()
  await AsyncStorage.removeItem(CHAT_READING_STORAGE_KEY)
})

// Every markdown block of a transcript reads the settings (useChatReadingSettings), and a chat opens
// with dozens of them before the first read has come back: they share that one read.
describe('many readers asking for the settings before the first read answers', () => {
  it('cause one read of storage, not one each', async () => {
    const original = AsyncStorage.getItem
    const read = vi.fn(async (key: string) => original(key))
    AsyncStorage.getItem = read
    try {
      await Promise.all(Array.from({ length: 40 }, () => loadChatReadingSettings()))
    } finally {
      AsyncStorage.getItem = original
    }
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('all get the same settings', async () => {
    await AsyncStorage.setItem(CHAT_READING_STORAGE_KEY, JSON.stringify({ textSize: 'large' }))
    const all = await Promise.all(Array.from({ length: 5 }, () => loadChatReadingSettings()))
    expect(all.map((settings) => settings.textSize)).toEqual(Array(5).fill('large'))
  })

  it('read again once the first read has finished, since storage may have changed', async () => {
    const original = AsyncStorage.getItem
    const read = vi.fn(async (key: string) => original(key))
    AsyncStorage.getItem = read
    try {
      await loadChatReadingSettings()
      await loadChatReadingSettings()
    } finally {
      AsyncStorage.getItem = original
    }
    expect(read).toHaveBeenCalledTimes(2)
  })
})
