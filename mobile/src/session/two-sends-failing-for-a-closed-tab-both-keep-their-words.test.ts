/**
 * Second review of the closed-chat restore, 2026-10-17: two refusals for one closed tab, back to
 * back, each read the stored draft and then wrote it, so the second write dropped the first
 * message. The Anthropic lane's queue give-back after the chat closed (restoreCcrQueueToStoredDraft)
 * does the same read-modify-write on the same key. Both now append through one per-key chain.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, expect, it } from 'vitest'
import { readNativeChatDraft } from '../storage/native-chat-drafts'
import { restoreCcrQueueToStoredDraft } from './ccr-composer-send-deps'
import { resetLiveNativeChatDraftsForTests, returnRejectedDraftWords, type MobileNativeChatLiveDrafts } from './mobile-native-chat-live-drafts'

const KEY = 'h\0w\0tab-s'
const gone: MobileNativeChatLiveDrafts = { setDrafts: () => undefined, setPendingBySession: () => undefined, setPendingWaitingForSession: () => undefined }

afterEach(async () => { resetLiveNativeChatDraftsForTests(); await AsyncStorage.clear() })

it('keeps both refused messages when two fail for a closed tab together', async () => {
  returnRejectedDraftWords(KEY, gone, 'first message')
  returnRejectedDraftWords(KEY, gone, 'second message')
  for (let i = 0; i < 10; i += 1) { await new Promise((r) => setTimeout(r, 0)) }
  const stored = await readNativeChatDraft(KEY)
  expect(stored).toContain('first message')
  expect(stored).toContain('second message')
})

it('keeps a refused message and queued words given back to the same closed tab together', async () => {
  returnRejectedDraftWords(KEY, gone, 'refused message')
  void restoreCcrQueueToStoredDraft(KEY, 'queued words')
  for (let i = 0; i < 10; i += 1) { await new Promise((r) => setTimeout(r, 0)) }
  const stored = await readNativeChatDraft(KEY)
  expect(stored).toContain('refused message')
  expect(stored).toContain('queued words')
})
