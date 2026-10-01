import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hydrateScheduledPromptMemory,
  rememberScheduledPrompts,
  rememberedScheduledPrompts,
  resetScheduledPromptMemoryForTests
} from './scheduled-prompt-memory'

// The chat matched a loop's tick only against the CronCreate calls on the
// pages it had loaded, so once the loop's call scrolled out, or after a
// relaunch whose first page no longer held it, every tick drew a user bubble
// again (2026-10-01). The phone now keeps the loop prompts it has seen, per
// Claude session, as long as the session's other caches.

const disk = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => disk.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      disk.set(key, value)
    })
  }
}))

/** The debounced write, landed. */
async function written(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1000)
}

/** A relaunch: memory gone, storage kept, read again at app start. */
async function relaunch(): Promise<void> {
  resetScheduledPromptMemoryForTests()
  await hydrateScheduledPromptMemory()
}

describe('the loop prompts a session has shown', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    disk.clear()
    resetScheduledPromptMemoryForTests()
    await hydrateScheduledPromptMemory()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('are kept for that session once seen, and only for it', () => {
    rememberScheduledPrompts('session-a', [{ words: 'check the deploy', cut: false }])
    expect(rememberedScheduledPrompts('session-a')).toEqual([{ words: 'check the deploy' }])
    expect(rememberedScheduledPrompts('session-b')).toEqual([])
  })

  it('outlive a relaunch', async () => {
    rememberScheduledPrompts('session-a', [{ words: 'check the deploy', cut: true }])
    await written()
    await relaunch()
    expect(rememberedScheduledPrompts('session-a')).toEqual([{ words: 'check the deploy', cut: true }])
  })

  it('keep each prompt once, the newest last, sixteen a session', () => {
    rememberScheduledPrompts('s', [{ words: 'a', cut: false }, { words: 'b', cut: false }])
    rememberScheduledPrompts('s', [{ words: 'a', cut: false }])
    expect(rememberedScheduledPrompts('s').map((entry) => entry.words)).toEqual(['b', 'a'])
    rememberScheduledPrompts(
      's',
      Array.from({ length: 20 }, (_, i) => ({ words: `loop ${i}`, cut: false }))
    )
    const kept = rememberedScheduledPrompts('s').map((entry) => entry.words)
    expect(kept).toHaveLength(16)
    expect(kept.at(-1)).toBe('loop 19')
  })

  it('keep a long prompt’s first thousand characters, marked cut', () => {
    rememberScheduledPrompts('s', [{ words: 'x'.repeat(1500), cut: false }])
    expect(rememberedScheduledPrompts('s')).toEqual([{ words: 'x'.repeat(1000), cut: true }])
  })

  it('write nothing when the prompts are the ones already kept', async () => {
    rememberScheduledPrompts('s', [{ words: 'a', cut: false }])
    await written()
    vi.mocked(AsyncStorage.setItem).mockClear()
    rememberScheduledPrompts('s', [{ words: 'a', cut: false }])
    await written()
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
  })

  describe('when storage fails', () => {
    it('still keep this run’s prompts when the stored ones cannot be read', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk full'))
      resetScheduledPromptMemoryForTests()
      await expect(hydrateScheduledPromptMemory()).resolves.toBeUndefined()
      rememberScheduledPrompts('s', [{ words: 'a', cut: false }])
      expect(rememberedScheduledPrompts('s')).toEqual([{ words: 'a' }])
    })

    it('read a corrupt stored copy as nothing kept', async () => {
      disk.set('codeui:chat-scheduled-prompts', '{not json')
      await relaunch()
      expect(rememberedScheduledPrompts('s')).toEqual([])
    })
  })

  describe('at the degenerate sizes', () => {
    it('keep nothing for no session, or for no prompts', async () => {
      rememberScheduledPrompts(null, [{ words: 'a', cut: false }])
      rememberScheduledPrompts('', [{ words: 'a', cut: false }])
      rememberScheduledPrompts('s', [])
      await written()
      expect(rememberedScheduledPrompts('s')).toEqual([])
      expect(disk.size).toBe(0)
    })
  })
})
