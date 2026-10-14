import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CHAT_READING_STORAGE_KEY,
  peekChatReadingSettings,
  resetChatReadingSettingsForTests
} from '../settings/chat-reading-settings'
import { hydrateSessionCaches } from './session-caches-hydrate'

beforeEach(async () => {
  resetChatReadingSettingsForTests()
  await AsyncStorage.removeItem(CHAT_READING_STORAGE_KEY)
})

// A reader who chose another transcript font or size must not see the chat paint in the defaults
// for a moment on a cold start: the reading settings are read with the other caches, before any
// project opens, so the first frame of a transcript already has them.
describe('the app’s start-up reads', () => {
  it('include how the transcript is read', async () => {
    await AsyncStorage.setItem(CHAT_READING_STORAGE_KEY, JSON.stringify({ textSize: 'large', transcriptFont: 'system' }))
    expect(peekChatReadingSettings()).toBeNull()
    await hydrateSessionCaches()
    expect(peekChatReadingSettings()).toMatchObject({ textSize: 'large', transcriptFont: 'system' })
  })
})
