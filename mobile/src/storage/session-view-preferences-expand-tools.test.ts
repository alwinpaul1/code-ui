// "Expand tool calls": every tool call opens with its details. It used to be a
// "Tools" button on the chat's chrome row whose state died with the screen; it
// is a device preference now, shaped like Focus view: an in-memory copy that
// answers synchronously, storage as the source of truth, subscribers so an
// open chat follows the Settings switch without a remount.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CHAT_EXPAND_TOOLS,
  hydrateSessionViewPreferences,
  loadChatExpandTools,
  loadChatFocusView,
  peekChatExpandTools,
  resetSessionViewPreferenceMemoryForTests,
  saveChatExpandTools,
  subscribeChatExpandTools
} from './session-view-preferences'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), getAllKeys: vi.fn(), multiGet: vi.fn() }
}))

describe('the Expand tool calls preference', () => {
  beforeEach(() => {
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockReset()
    vi.mocked(AsyncStorage.getAllKeys).mockReset()
    vi.mocked(AsyncStorage.multiGet).mockReset()
    vi.mocked(AsyncStorage.setItem).mockResolvedValue(undefined)
    resetSessionViewPreferenceMemoryForTests()
  })

  it('is off by default: nothing stored, an unknown word, or storage down', async () => {
    expect(DEFAULT_CHAT_EXPAND_TOOLS).toBe(false)
    expect(peekChatExpandTools()).toBeNull()
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null)
    await expect(loadChatExpandTools()).resolves.toBe(false)
    resetSessionViewPreferenceMemoryForTests()
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce('maybe')
    await expect(loadChatExpandTools()).resolves.toBe(false)
    resetSessionViewPreferenceMemoryForTests()
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage down'))
    await expect(loadChatExpandTools()).resolves.toBe(false)
  })

  it('saves, then answers the saved value to a peek, under its own key', async () => {
    await saveChatExpandTools(true)
    expect(peekChatExpandTools()).toBe(true)
    expect(vi.mocked(AsyncStorage.setItem)).toHaveBeenCalledWith('orca:chatExpandTools', 'on')
    resetSessionViewPreferenceMemoryForTests()
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce('on')
    await expect(loadChatExpandTools()).resolves.toBe(true)
  })

  it('tells subscribers about a save before storage answers, and stops after unsubscribe', async () => {
    const seen: (boolean | null)[] = []
    const unsubscribe = subscribeChatExpandTools(() => seen.push(peekChatExpandTools()))
    const write = saveChatExpandTools(true)
    expect(seen).toEqual([true])
    await write
    unsubscribe()
    await saveChatExpandTools(false)
    expect(seen).toEqual([true])
  })

  it('does not share a value with Focus view', async () => {
    await saveChatExpandTools(true)
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null)
    await expect(loadChatFocusView()).resolves.toBe(false)
  })

  it('puts the memory copy back to what storage holds after a refused write', async () => {
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'))
    await expect(saveChatExpandTools(true)).rejects.toThrow('disk full')
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null)
    await expect(loadChatExpandTools()).resolves.toBe(false)
    expect(peekChatExpandTools()).toBe(false)
  })

  it('keeps a save made while a read was in flight over the stale answer', async () => {
    let answer: (value: string | null) => void = () => {}
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(
      () => new Promise((resolve) => { answer = resolve })
    )
    const load = loadChatExpandTools()
    await Promise.resolve()
    await Promise.resolve()
    const save = saveChatExpandTools(true)
    answer(null)
    await expect(load).resolves.toBe(true)
    await save
    expect(peekChatExpandTools()).toBe(true)
  })

  it('warms at app start without overriding a fresher save', async () => {
    vi.mocked(AsyncStorage.getAllKeys).mockResolvedValue([])
    vi.mocked(AsyncStorage.multiGet).mockResolvedValue([['orca:chatExpandTools', 'on']])
    await hydrateSessionViewPreferences()
    expect(peekChatExpandTools()).toBe(true)
    expect(vi.mocked(AsyncStorage.multiGet).mock.calls[0]?.[0]).toContain('orca:chatExpandTools')
    resetSessionViewPreferenceMemoryForTests()
    void saveChatExpandTools(false)
    await hydrateSessionViewPreferences()
    expect(peekChatExpandTools()).toBe(false)
  })
})
