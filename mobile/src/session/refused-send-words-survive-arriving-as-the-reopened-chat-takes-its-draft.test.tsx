/**
 * Fourth review, 2026-10-17: a send refused a microtask after the reopened chat's hydration read
 * had its stored draft, before the screen took it. The words skipped the still-unread screen, the
 * screen then took the draft without them, and its next save wrote that over the stored draft
 * that held them, with the outbox entry already retired: the words were gone everywhere. The
 * screen now takes the draft with every append made since its read began, at the moment it takes
 * it, so no gap is left whatever the timing (depths 0 to 6 below).
 * Also: a read whose getItem rejects, and a read behind a write that rejects.
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
type Drafts = ReturnType<typeof useMobileNativeChatDrafts>
const handles: Record<string, Drafts> = {}
const renderers: ReactTestRenderer[] = []
function ChatScreen({ name }: { name: string }): null {
  handles[name] = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId: 'tab-s', sessionId: 'session-s', messages: [], transcriptSettled: true })
  return null
}
function mount(name: string): void {
  let r: ReactTestRenderer | null = null
  act(() => { r = create(createElement(ChatScreen, { name })) })
  renderers.push(r!)
}
async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  }
}
function nest(depth: number, run: () => void): void {
  if (depth === 0) {
    run()
    return
  }
  void Promise.resolve().then(() => nest(depth - 1, run))
}

beforeEach(() => {
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const r of renderers.splice(0)) {
    act(() => r.unmount())
  }
  resetLiveNativeChatDraftsForTests()
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
  await clearNativeChatDraftStores()
  await AsyncStorage.clear()
})

describe("a refused send's words arriving just as the reopened chat takes its stored draft", () => {
  for (const depth of [0, 1, 2, 3, 4, 5, 6]) {
    it(`stay on screen and on disk when they arrive ${depth} microtasks after the read has the draft`, async () => {
      mount('first')
      act(() => handles.first.setComposerText(TEXT))
      let origin: MobileNativeChatSendOrigin | null = null
      act(() => {
        origin = handles.first.captureSendOrigin(TEXT)
        recordOutboxSend(origin!, TEXT)
        handles.first.clearDraftForSend(origin!, TEXT)
      })
      await settle(100)
      act(() => handles.first.setComposerText('next'))
      await settle(100)
      act(() => renderers.shift()!.unmount())
      const original = AsyncStorage.getItem.bind(AsyncStorage)
      let armed = true
      vi.spyOn(AsyncStorage, 'getItem').mockImplementation((key: string) => {
        const p = original(key)
        if (armed && key === STORAGE_KEY) {
          armed = false
          void p.then(() => nest(depth, () => handles.first.restoreRejectedDraft(origin!, TEXT)))
        }
        return p
      })
      mount('second')
      await settle(100)
      const disk = (await original(STORAGE_KEY)) ?? ''
      expect({ screen: handles.second.composerText, disk, outbox: nativeChatOutboxEntries().map((e) => e.text) }).toEqual({ screen: `next\n\n${TEXT}`, disk: `next\n\n${TEXT}`, outbox: [] })
    })
  }
})

describe('a draft read that fails', () => {
  it('leaves no reader behind holding merge records when its getItem rejects', async () => {
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'))
    const read = readNativeChatDraft(KEY)
    const before = nativeChatDraftEpoch()
    await appendNativeChatDraft(KEY, (s) => (s ? `${s}\n\nW` : 'W'))
    expect(await read).toBeNull()
    // With no reader out, a save read after the append forgets it; a save stamped before re-applies it.
    await writeNativeChatDraft(KEY, 'later', before + 1)
    await writeNativeChatDraft(KEY, 'later2', before)
    expect(await readNativeChatDraft(KEY)).toBe('later2')
  })

  it('still resolves behind a write that rejects', async () => {
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'))
    await AsyncStorage.setItem(STORAGE_KEY, 'old').catch(() => undefined)
    const failing = writeNativeChatDraft(KEY, 'x').catch(() => 'rejected')
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'))
    const failingAppend = appendNativeChatDraft(KEY, (s) => `${s}+W`).catch(() => 'rejected')
    const read = await Promise.race([readNativeChatDraft(KEY), new Promise((r) => setTimeout(() => r('HUNG'), 500))])
    expect(read).not.toBe('HUNG')
    await failing
    await failingAppend
  })
})
