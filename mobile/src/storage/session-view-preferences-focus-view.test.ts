// "Focus view" (extension `claudeCode.focusView`): tool activity folds to one
// "N tool calls" row per run. The preference lives beside the other session
// view preferences, with the same shape: an in-memory copy that answers
// synchronously, storage as the source of truth, and subscribers so an open
// chat follows a toggle made on the Settings screen without a remount.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hydrateSessionViewPreferences,
  loadChatFocusView,
  peekChatFocusView,
  resetSessionViewPreferenceMemoryForTests,
  saveChatFocusView,
  subscribeChatFocusView
} from './session-view-preferences'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), getAllKeys: vi.fn(), multiGet: vi.fn() }
}))

describe('the Focus view preference', () => {
  beforeEach(() => {
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockReset()
    vi.mocked(AsyncStorage.getAllKeys).mockReset()
    vi.mocked(AsyncStorage.multiGet).mockReset()
    vi.mocked(AsyncStorage.setItem).mockResolvedValue(undefined)
    resetSessionViewPreferenceMemoryForTests()
  })

  it('answers null before the first read, then the stored value synchronously', async () => {
    expect(peekChatFocusView()).toBeNull()
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce('on')
    await expect(loadChatFocusView()).resolves.toBe(true)
    expect(peekChatFocusView()).toBe(true)
    expect(vi.mocked(AsyncStorage.getItem).mock.calls[0]?.[0]).toBe('orca:chatFocusView')
  })

  it('is off when nothing is stored, and off on a value it does not recognise', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null)
    await expect(loadChatFocusView()).resolves.toBe(false)
    resetSessionViewPreferenceMemoryForTests()
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce('yes please')
    await expect(loadChatFocusView()).resolves.toBe(false)
  })

  it('tells subscribers about a save before storage has answered, then lands it', async () => {
    const seen: (boolean | null)[] = []
    const unsubscribe = subscribeChatFocusView(() => seen.push(peekChatFocusView()))
    const write = saveChatFocusView(true)
    expect(seen).toEqual([true])
    expect(peekChatFocusView()).toBe(true)
    await write
    expect(vi.mocked(AsyncStorage.setItem)).toHaveBeenCalledWith('orca:chatFocusView', 'on')
    unsubscribe()
    await saveChatFocusView(false)
    expect(seen).toEqual([true])
  })

  it('keeps the memory copy honest after a save the storage refused', async () => {
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'))
    await expect(saveChatFocusView(true)).rejects.toThrow('disk full')
    // The optimistic copy said "on"; the next read says what storage holds.
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null)
    await expect(loadChatFocusView()).resolves.toBe(false)
    expect(peekChatFocusView()).toBe(false)
  })

  it('lets a save made while a read was in flight win over the stale value that read brings back', async () => {
    // The chat mounts, asks storage (slow), and the user flips the switch
    // before the answer lands. The answer is what storage held BEFORE the
    // flip; it must not put the switch back.
    let answer: (value: string | null) => void = () => {}
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(
      () => new Promise((resolve) => { answer = resolve })
    )
    const load = loadChatFocusView()
    await Promise.resolve()
    await Promise.resolve()
    expect(vi.mocked(AsyncStorage.getItem)).toHaveBeenCalledTimes(1)
    const save = saveChatFocusView(true)
    expect(peekChatFocusView()).toBe(true)
    answer(null)
    await expect(load).resolves.toBe(true)
    await save
    expect(peekChatFocusView()).toBe(true)
  })

  it('reads a storage failure as "off", not as a crash', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage down'))
    await expect(loadChatFocusView()).resolves.toBe(false)
  })

  it('warms at app start with the other view preferences, without overriding a fresher save', async () => {
    vi.mocked(AsyncStorage.getAllKeys).mockResolvedValue(['orca:defaultSessionView'])
    vi.mocked(AsyncStorage.multiGet).mockResolvedValue([
      ['orca:defaultSessionView', 'chat'],
      ['orca:chatFocusView', 'on']
    ])
    await hydrateSessionViewPreferences()
    expect(peekChatFocusView()).toBe(true)
    expect(vi.mocked(AsyncStorage.multiGet).mock.calls[0]?.[0]).toContain('orca:chatFocusView')

    resetSessionViewPreferenceMemoryForTests()
    void saveChatFocusView(false)
    await hydrateSessionViewPreferences()
    expect(peekChatFocusView()).toBe(false)
  })
})
