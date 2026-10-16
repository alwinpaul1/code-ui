/**
 * A refused send's words put back into the OPEN chat (2026-10-17, after the second review of the
 * closed-chat restore). The restore retired the send's outbox entry at once and left the words
 * only in the screen's React state, which reaches disk on a 250 ms debounce. An app killed inside
 * that window had them in neither place. The words now go to the stored draft at once, through
 * the per-key write chain, and the outbox entry goes only once they are there: the worst case is
 * a resend of words that are also back in the draft, never a loss.
 *
 * Drives the REAL draft store, its debounced persistence, and the outbox.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendNativeChatDraft, nativeChatDraftEpoch, readNativeChatDraft, writeNativeChatDraft } from '../storage/native-chat-drafts'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { recordOutboxSend, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

const KEY = 'h\0w\0tab-s'
const STORAGE_KEY = `orca:chatDraft:${encodeURIComponent(KEY)}`
const TEXT = 'deploy it when the tests pass'

let renderer: ReactTestRenderer | null = null
let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null

function ChatScreen(): null {
  drafts = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId: 'tab-s', sessionId: 'session-s', messages: [], transcriptSettled: true })
  return null
}
async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  }
}
/** What a process killed now would find on disk: the stored draft and the outbox. */
async function onDisk(): Promise<{ draft: string; outbox: string[] }> {
  return {
    draft: (await AsyncStorage.getItem(STORAGE_KEY)) ?? '',
    outbox: nativeChatOutboxEntries().map((entry) => entry.text)
  }
}
const survives = ({ draft, outbox }: { draft: string; outbox: string[] }): boolean => draft.includes(TEXT) || outbox.includes(TEXT)

/** The send is out: the composer is cleared, the outbox holds it, the erase has reached disk. */
async function sendThatWillBeRefused(): Promise<MobileNativeChatSendOrigin> {
  act(() => { renderer = create(createElement(ChatScreen)) })
  act(() => drafts!.setComposerText(TEXT))
  let origin: MobileNativeChatSendOrigin | null = null
  act(() => {
    origin = drafts!.captureSendOrigin(TEXT)
    recordOutboxSend(origin!, TEXT)
    drafts!.clearDraftForSend(origin!, TEXT)
  })
  await settle(100)
  expect(await onDisk()).toEqual({ draft: '', outbox: [TEXT] })
  return origin!
}

beforeEach(() => {
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
})
afterEach(async () => {
  vi.restoreAllMocks()
  act(() => renderer?.unmount())
  renderer = null
  resetLiveNativeChatDraftsForTests()
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
  await clearNativeChatDraftStores()
  await AsyncStorage.clear()
})

describe("a refused send's words put back into the open chat", () => {
  it('survive the app being killed right after they reappear in the open chat', async () => {
    const origin = await sendThatWillBeRefused()
    act(() => drafts!.restoreRejectedDraft(origin, TEXT))
    expect(drafts!.composerText).toBe(TEXT)
    // A kill at any moment from here on must find them somewhere; well inside the 250 ms debounce.
    for (let i = 0; i < 6; i += 1) {
      expect(survives(await onDisk())).toBe(true)
      await act(async () => { await Promise.resolve() })
    }
    await settle(0)
    expect(survives(await onDisk())).toBe(true)
    // Once settled: in the draft, and out of the outbox (one copy).
    await settle(100)
    expect(await onDisk()).toEqual({ draft: TEXT, outbox: [] })
  })

  it('keep what the user types after they reappear, after them, on screen and on disk', async () => {
    const origin = await sendThatWillBeRefused()
    act(() => drafts!.setComposerText('half'))
    // Refused while the half-typed note is still waiting out its debounce.
    act(() => drafts!.restoreRejectedDraft(origin, TEXT))
    act(() => drafts!.setComposerText((current) => `${current} and more`))
    expect(drafts!.composerText).toBe(`half\n\n${TEXT} and more`)
    await settle(100)
    expect(await onDisk()).toEqual({ draft: `half\n\n${TEXT} and more`, outbox: [] })
  })

  it('stay in the outbox, and say so, when the stored draft cannot be written', async () => {
    const origin = await sendThatWillBeRefused()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'))
    act(() => drafts!.restoreRejectedDraft(origin, TEXT))
    await settle(100)
    expect(drafts!.composerText).toBe(TEXT)
    expect(nativeChatOutboxEntries().map((entry) => entry.text)).toEqual([TEXT])
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toMatch(/open chat.*disk full.*kept in the outbox/)
  })
})

describe('a save of the composer read before words came back to it', () => {
  it('does not write over the words', async () => {
    await writeNativeChatDraft(KEY, 'note')
    const readBefore = nativeChatDraftEpoch()
    await appendNativeChatDraft(KEY, (stored) => `${stored}\n\n${TEXT}`)
    // The screen's debounce fires with the value it read before the words came back.
    await writeNativeChatDraft(KEY, 'note more', readBefore)
    expect(await readNativeChatDraft(KEY)).toBe(`note more\n\n${TEXT}`)
    // A save read after them is written as it is: the user may have edited them.
    await writeNativeChatDraft(KEY, 'edited', nativeChatDraftEpoch())
    expect(await readNativeChatDraft(KEY)).toBe('edited')
  })

  it('that was an erase does not erase them', async () => {
    const readBefore = nativeChatDraftEpoch()
    await appendNativeChatDraft(KEY, (stored) => (stored ? `${stored}\n\n${TEXT}` : TEXT))
    await writeNativeChatDraft(KEY, '', readBefore)
    expect(await readNativeChatDraft(KEY)).toBe(TEXT)
  })
})
