/**
 * A refused send's words given back while a screen on the tab is still hydrating its draft
 * (third review, 2026-10-17). The hydration read the stored draft from before the words were
 * appended to it, and either
 *  - a second screen pushed over the sender (the agent-history panel) then saved that old draft
 *    over the words, stamped as if it had read them, after the outbox entry was retired; or
 *  - the reopened screen of a closed chat, the one shown now, was given the words alone on its
 *    unread draft, which stopped its hydration and wrote them over what the user had typed.
 * A hydration read now gets every append made since it started, and an unread draft is given
 * what the stored draft holds once the words are in it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeChatDraftEpoch, readNativeChatDraft, writeNativeChatDraft } from '../storage/native-chat-drafts'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { giveWordsToTabDraft, resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
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
function mount(name: string): ReactTestRenderer {
  let r: ReactTestRenderer | null = null
  act(() => { r = create(createElement(ChatScreen, { name })) })
  renderers.push(r!)
  return r!
}
async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  }
}
/** Holds the NEXT getItem of the draft key (the hydration read) until released, with the value it read at call time. */
function holdNextDraftRead(): () => void {
  const original = AsyncStorage.getItem.bind(AsyncStorage)
  let release: () => void = () => undefined
  let armed = true
  vi.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key: string) => {
    const value = await original(key)
    if (armed && key === STORAGE_KEY) {
      armed = false
      await new Promise<void>((resolve) => { release = resolve })
    }
    return value
  })
  return () => release()
}

async function sendThenTypeMore(): Promise<MobileNativeChatSendOrigin> {
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
  expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('next')
  return origin!
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

describe("a refused send's words given back while a screen on the tab is still reading its draft", () => {
  it('keeps what the user typed and the words when the chat was reopened and is still reading its draft', async () => {
    const origin = await sendThenTypeMore()
    act(() => renderers.shift()!.unmount())
    const release = holdNextDraftRead()
    mount('second')
    await settle(0)
    act(() => handles.first.restoreRejectedDraft(origin, TEXT))
    release()
    await settle(100)
    const disk = (await AsyncStorage.getItem(STORAGE_KEY)) ?? ''
    const outbox = nativeChatOutboxEntries().map((e) => e.text)
    expect({ screen: handles.second.composerText, disk, outbox }).toEqual({ screen: `next\n\n${TEXT}`, disk: `next\n\n${TEXT}`, outbox: [] })
  })

  it('keeps the words on disk and on the screen pushed over the sender while that screen is still reading its draft', async () => {
    const origin = await sendThenTypeMore()
    const release = holdNextDraftRead()
    mount('second')
    await settle(0)
    act(() => handles.first.restoreRejectedDraft(origin, TEXT))
    await settle(10)
    release()
    await settle(100)
    const disk = (await AsyncStorage.getItem(STORAGE_KEY)) ?? ''
    const outbox = nativeChatOutboxEntries().map((e) => e.text)
    expect({ first: handles.first.composerText, second: handles.second.composerText, disk, outbox }).toEqual({ first: `next\n\n${TEXT}`, second: `next\n\n${TEXT}`, disk: `next\n\n${TEXT}`, outbox: [] })
  })
})

describe("a refused send's words given back while the reopened chat is still reading its draft, typed into first", () => {
  // Fifth review, 2026-10-17: the user typed before the read was taken. Typing first wins over the
  // stored copy, so the screen never took it, the words had skipped the still-unread screen, and
  // its save wrote what was typed over them, with the outbox entry already retired.
  it('keeps the words after what the user typed before the chat took its draft', async () => {
    const origin = await sendThenTypeMore()
    act(() => renderers.shift()!.unmount())
    const release = holdNextDraftRead()
    mount('second')
    await settle(10)
    // The user types into the still-unread box before the words' stored write has landed.
    act(() => {
      handles.first.restoreRejectedDraft(origin, TEXT)
      handles.second.setComposerText('typed')
    })
    await settle(10)
    release()
    await settle(150)
    const disk = (await AsyncStorage.getItem(STORAGE_KEY)) ?? ''
    const outbox = nativeChatOutboxEntries().map((entry) => entry.text)
    expect({ screen: handles.second.composerText, disk, outbox }).toEqual({ screen: `typed\n\n${TEXT}`, disk: `typed\n\n${TEXT}`, outbox: [] })
  })
})

describe('an append to a tab no screen shows', () => {
  it('stops re-applying an append to a tab no screen shows once it is on disk', async () => {
    const before = nativeChatDraftEpoch()
    await giveWordsToTabDraft(KEY, (stored) => (stored ? `${stored}\n\n${TEXT}` : TEXT))
    expect(await readNativeChatDraft(KEY)).toBe(TEXT)
    // Its record is gone: only a save read before it would re-apply it, and no screen held one.
    await writeNativeChatDraft(KEY, 'typed later', before)
    expect(await readNativeChatDraft(KEY)).toBe('typed later')
  })
})
