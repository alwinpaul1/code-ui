/**
 * Second review of the closed-chat restore, 2026-10-17:
 *  - a reopened tab that hydrates its draft while a refused send's words are still being appended
 *    to the stored draft read the old draft, and its next save erased the words. The hydration
 *    read waits on the same per-key chain the append runs on, so it reads them;
 *  - the outbox entry was retired before the stored write landed, so a kill between the two lost
 *    the words. The entry now goes only once the draft holds them: the worst case is a resend of
 *    words that are also back in the draft, never a loss.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readNativeChatDraft } from '../storage/native-chat-drafts'
import { resetLiveNativeChatDraftsForTests, returnRejectedDraftWords, type MobileNativeChatLiveDrafts } from './mobile-native-chat-live-drafts'

const KEY = 'h\0w\0tab-s'
const gone: MobileNativeChatLiveDrafts = { setDrafts: () => undefined, setPendingBySession: () => undefined, setPendingWaitingForSession: () => undefined }
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i += 1) { await new Promise((r) => setTimeout(r, 0)) } }

afterEach(async () => {
  vi.restoreAllMocks()
  resetLiveNativeChatDraftsForTests()
  await AsyncStorage.clear()
})

/** Holds every AsyncStorage.setItem until `release`. */
function holdSaves(): { release: () => void } {
  const original = AsyncStorage.setItem.bind(AsyncStorage)
  let open!: () => void
  const gate = new Promise<void>((resolve) => { open = resolve })
  vi.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key: string, value: string) => { await gate; return original(key, value) })
  return { release: open }
}

describe("a refused send's words on their way into a closed tab's stored draft", () => {
  it('are what a tab reopened meanwhile hydrates', async () => {
    await AsyncStorage.setItem(`orca:chatDraft:${encodeURIComponent(KEY)}`, 'note')
    const saves = holdSaves()
    returnRejectedDraftWords(KEY, gone, 'refused words')
    // The reopened screen's hydration read starts in the same tick, before the append has read.
    const hydrated = readNativeChatDraft(KEY)
    saves.release()
    expect(await hydrated).toBe('note\n\nrefused words')
  })

  it('leave the outbox only once the stored draft holds them', async () => {
    const saves = holdSaves()
    const retire = vi.fn()
    returnRejectedDraftWords(KEY, gone, 'refused words', retire)
    await flush()
    expect(retire).not.toHaveBeenCalled()
    saves.release()
    await flush()
    expect(retire).toHaveBeenCalledTimes(1)
    expect(await readNativeChatDraft(KEY)).toBe('refused words')
  })

  it('stay in the outbox when the stored draft cannot be written', async () => {
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const retire = vi.fn()
    returnRejectedDraftWords(KEY, gone, 'refused words', retire)
    await flush()
    expect(retire).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().join(' ')).toMatch(/disk full.*kept in the outbox/)
  })
})
