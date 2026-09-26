import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hydrateNativeChatImagePreviewCache,
  knownNativeChatImagePreviews,
  loadNativeChatImagePreviews,
  nativeChatImagePreviewsSettledThisRun,
  resetNativeChatImagePreviewCacheForTests,
  saveNativeChatImagePreviews
} from './mobile-native-chat-image-preview-cache'

// A chat that comes back is painted at once from the kept transcript; the
// photos the phone sent in it must be known by then, or each is drawn as
// "Image on Desktop" until a storage read lands (2026-09-26).
const session = (tab: string, id: string) => ['host', 'worktree', tab, id].join('\u0000')
const S1 = session('tab', '967668df-a7d9-40e7-964b-7812815c010d')
const RECENT_KEY = 'codeui:chat-image-previews-recent'
const sessionEntry = (sessionKey: string) => `orca:chatImagePreviews:${encodeURIComponent(sessionKey)}`

/** The next run: nothing in memory, only what storage kept. */
async function relaunch(): Promise<void> {
  resetNativeChatImagePreviewCacheForTests()
  await hydrateNativeChatImagePreviewCache()
}

async function flushWrites(): Promise<void> {
  vi.advanceTimersByTime(1_000)
  await Promise.resolve()
  await Promise.resolve()
}

describe('the phone’s photo previews, known before a chat reads them', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    await AsyncStorage.clear()
    resetNativeChatImagePreviewCacheForTests()
  })
  afterEach(() => {
    resetNativeChatImagePreviewCacheForTests()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // A marked-up photo, or a clipboard paste with no file, has a `data:`
  // preview. Storage leaves those out for its size cap; this run keeps them,
  // so the photo is still a picture when its chat comes back (review,
  // 2026-09-26). The next run gets what storage keeps.
  it('knows a session’s photos once this run saves them, marked-up ones too, and keeps for the next run what storage keeps', async () => {
    const marked = ['file:///a1.jpg', 'data:image/png;base64,AAAA']
    await saveNativeChatImagePreviews(S1, { '40b55aba': marked })
    expect(knownNativeChatImagePreviews(S1)).toEqual({ '40b55aba': marked })
    expect(nativeChatImagePreviewsSettledThisRun(S1)).toBe(true)
    expect(JSON.parse((await AsyncStorage.getItem(sessionEntry(S1)))!)).toEqual({ '40b55aba': ['file:///a1.jpg'] })
    await flushWrites()
    await relaunch()
    expect(knownNativeChatImagePreviews(S1)).toEqual({ '40b55aba': ['file:///a1.jpg'] })
  })

  it('keeps the photos of the last eight sessions of this run, and reads an older one again', async () => {
    const sessions = Array.from({ length: 9 }, (_, index) => session(`run${index}`, `id${index}`))
    for (const [index, sessionKey] of sessions.entries()) {
      await saveNativeChatImagePreviews(sessionKey, { [`m${index}`]: [`data:image/png;base64,${index}`] })
    }
    expect(nativeChatImagePreviewsSettledThisRun(sessions[0]!)).toBe(false)
    expect(nativeChatImagePreviewsSettledThisRun(sessions[1]!)).toBe(true)
    expect(knownNativeChatImagePreviews(sessions[8]!)).toEqual({ m8: ['data:image/png;base64,8'] })
  })

  // A photo landed, then the tab changed before the chat's read came back:
  // the write of the chat's map replaced the stored entry, and the session's
  // older photos were gone for good (review, 2026-09-26).
  it('never writes a session this run has not read over the photos storage holds for it', async () => {
    await AsyncStorage.setItem(sessionEntry(S1), JSON.stringify({ m1: ['file:///old.jpg'] }))
    await saveNativeChatImagePreviews(S1, { m3: ['file:///new.jpg'] })
    expect(JSON.parse((await AsyncStorage.getItem(sessionEntry(S1)))!)).toEqual({
      m1: ['file:///old.jpg'],
      m3: ['file:///new.jpg']
    })
    expect(knownNativeChatImagePreviews(S1)).toEqual({ m1: ['file:///old.jpg'], m3: ['file:///new.jpg'] })
  })

  it('brings a recent session’s photos back after a relaunch, before its chat reads them', async () => {
    await saveNativeChatImagePreviews(S1, { '40b55aba': ['file:///a1.jpg', 'file:///a2.jpg'] })
    await flushWrites()
    await relaunch()
    expect(knownNativeChatImagePreviews(S1)).toEqual({ '40b55aba': ['file:///a1.jpg', 'file:///a2.jpg'] })
    // Only a start: the chat still reads its own entry, which is the record.
    expect(nativeChatImagePreviewsSettledThisRun(S1)).toBe(false)
  })

  it('keeps the twelve most recent sessions for the next run, and reads the rest when they open', async () => {
    const sessions = Array.from({ length: 13 }, (_, index) => session(`tab${index}`, `id${index}`))
    for (const [index, sessionKey] of sessions.entries()) {
      await saveNativeChatImagePreviews(sessionKey, { [`m${index}`]: [`file:///${index}.jpg`] })
    }
    await flushWrites()
    await relaunch()
    expect(knownNativeChatImagePreviews(sessions[0]!)).toBeUndefined()
    expect(knownNativeChatImagePreviews(sessions[1]!)).toEqual({ m1: ['file:///1.jpg'] })
    expect(knownNativeChatImagePreviews(sessions[12]!)).toEqual({ m12: ['file:///12.jpg'] })
    expect(await loadNativeChatImagePreviews(sessions[0]!)).toEqual({ m0: ['file:///0.jpg'] })
    expect(knownNativeChatImagePreviews(sessions[0]!)).toEqual({ m0: ['file:///0.jpg'] })
  })

  it('leaves each chat to read its own when the recent copy will not parse', async () => {
    await AsyncStorage.setItem(RECENT_KEY, '{not json')
    await AsyncStorage.setItem(sessionEntry(S1), JSON.stringify({ '40b55aba': ['file:///a1.jpg'] }))
    await expect(hydrateNativeChatImagePreviewCache()).resolves.toBeUndefined()
    expect(knownNativeChatImagePreviews(S1)).toBeUndefined()
    expect(await loadNativeChatImagePreviews(S1)).toEqual({ '40b55aba': ['file:///a1.jpg'] })
  })

  it('knows nothing from a read that fails, so the next open reads again', async () => {
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    expect(await loadNativeChatImagePreviews(S1)).toBeNull()
    expect(knownNativeChatImagePreviews(S1)).toBeUndefined()
    expect(nativeChatImagePreviewsSettledThisRun(S1)).toBe(false)
  })

  it('keeps what this run saved over an older copy a later read finds', async () => {
    await saveNativeChatImagePreviews(S1, { '40b55aba': ['file:///new.jpg'] })
    await AsyncStorage.setItem(sessionEntry(S1), JSON.stringify({ old: ['file:///old.jpg'] }))
    await loadNativeChatImagePreviews(S1)
    expect(knownNativeChatImagePreviews(S1)).toEqual({ '40b55aba': ['file:///new.jpg'] })
  })

  it('knows a session whose photos were all cleared as cleared', async () => {
    await saveNativeChatImagePreviews(S1, { '40b55aba': ['file:///a1.jpg'] })
    await saveNativeChatImagePreviews(S1, {})
    expect(knownNativeChatImagePreviews(S1)).toEqual({})
    expect(await AsyncStorage.getItem(sessionEntry(S1))).toBeNull()
  })
})
