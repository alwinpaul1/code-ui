import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import {
  loadNativeChatImagePreviews,
  nativeChatImagePreviewsSettledThisRun,
  resetNativeChatImagePreviewCacheForTests,
  saveNativeChatImagePreviews
} from './mobile-native-chat-image-preview-cache'
import { readNativeChatImagePreviews, writeNativeChatImagePreviews } from '../storage/native-chat-image-previews'

// A session's photo previews sit under one key, so each save is the whole
// map. A save the run had not read the session for reads storage first and
// merges; a read AsyncStorage refused came back as "nothing stored", the
// save wrote its own map over the stored one, and every earlier photo in
// that chat was drawn as "Image on Desktop" from then on (2026-09-30). The
// refusal is driven for real here: getItem rejects.

const S1 = ['host', 'worktree', 'tab', '967668df-a7d9-40e7-964b-7812815c010d'].join('\u0000')
const EARLIER = { m1: ['file:///earlier.jpg'] }
const NEW = { m2: ['file:///new.jpg'] }
const LATER = { m3: ['file:///later.jpg'] }

describe('a photo preview saved while storage refuses to read the session', () => {
  let warn: MockInstance<typeof console.warn>
  const refuseReads = (): MockInstance =>
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('storage unavailable'))

  beforeEach(async () => {
    await AsyncStorage.clear()
    resetNativeChatImagePreviewCacheForTests()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    resetNativeChatImagePreviewCacheForTests()
    vi.restoreAllMocks()
  })

  it('keeps the earlier previews, and writes the new one with them once a read succeeds', async () => {
    await writeNativeChatImagePreviews(S1, EARLIER)
    const reads = refuseReads()
    await saveNativeChatImagePreviews(S1, NEW)
    reads.mockRestore()
    expect(await readNativeChatImagePreviews(S1)).toEqual(EARLIER)
    expect(nativeChatImagePreviewsSettledThisRun(S1)).toBe(false)
    await saveNativeChatImagePreviews(S1, LATER)
    expect(await readNativeChatImagePreviews(S1)).toEqual({ ...EARLIER, ...NEW, ...LATER })
  })

  it('says why in one line, however many saves it skips', async () => {
    await writeNativeChatImagePreviews(S1, EARLIER)
    refuseReads()
    await saveNativeChatImagePreviews(S1, NEW)
    await saveNativeChatImagePreviews(S1, { ...NEW, ...LATER })
    const lines = warn.mock.calls.map((call) => String(call[0]))
    expect(lines.filter((line) => line.includes('could not save the chat photo previews'))).toHaveLength(1)
  })

  it('merges at once when storage refuses one read and hands over the next', async () => {
    await writeNativeChatImagePreviews(S1, EARLIER)
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage unavailable'))
    await saveNativeChatImagePreviews(S1, NEW)
    expect(await readNativeChatImagePreviews(S1)).toEqual({ ...EARLIER, ...NEW })
  })

  it('never erases the stored previews with an empty save it could not merge', async () => {
    await writeNativeChatImagePreviews(S1, EARLIER)
    const reads = refuseReads()
    await saveNativeChatImagePreviews(S1, {})
    reads.mockRestore()
    expect(await readNativeChatImagePreviews(S1)).toEqual(EARLIER)
  })

  it('names a refused load, and loads the earlier previews once storage reads again', async () => {
    await writeNativeChatImagePreviews(S1, EARLIER)
    const reads = refuseReads()
    expect(await loadNativeChatImagePreviews(S1)).toBeNull()
    expect(warn.mock.calls.some((call) => String(call[0]).includes('could not read the chat photo previews'))).toBe(true)
    reads.mockRestore()
    expect(await loadNativeChatImagePreviews(S1)).toEqual(EARLIER)
  })

  it('writes the save alone over a session with nothing stored', async () => {
    const reads = refuseReads()
    await saveNativeChatImagePreviews(S1, NEW)
    reads.mockRestore()
    expect(await readNativeChatImagePreviews(S1)).toBeNull()
    await saveNativeChatImagePreviews(S1, NEW)
    expect(await readNativeChatImagePreviews(S1)).toEqual(NEW)
  })
})
