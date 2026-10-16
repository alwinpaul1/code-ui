/**
 * Second review of the closed-chat restore, 2026-10-17: a send that failed after its chat closed
 * while ANOTHER mounted screen held the tab's draft in its React state but showed a different tab
 * now. The stored draft got the words, the mounted screen's cached copy did not, and switching
 * back wrote the cached copy over the stored one: the words were gone, and the outbox entry was
 * already retired. Every mounted store that holds the tab's draft now gets them too.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { readNativeChatDraft } from '../storage/native-chat-drafts'
import { resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

const KEY = 'h\0w\0tab-s'
const TEXT = 'deploy it when the tests pass'

let first: ReactTestRenderer | null = null
let second: ReactTestRenderer | null = null
let a: ReturnType<typeof useMobileNativeChatDrafts> | null = null
let x: ReturnType<typeof useMobileNativeChatDrafts> | null = null

function ScreenA(): null {
  a = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId: 'tab-s', sessionId: 'session-s', messages: [], transcriptSettled: true })
  return null
}
function ScreenX({ tabId }: { tabId: string }): null {
  x = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId, sessionId: `session-${tabId}`, messages: [], transcriptSettled: true })
  return null
}
async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  }
}

afterEach(async () => {
  act(() => { first?.unmount(); second?.unmount() })
  first = null
  second = null
  resetLiveNativeChatDraftsForTests()
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
  await clearNativeChatDraftStores()
  await AsyncStorage.clear()
})

describe('a message whose send fails after its chat closed, while another screen holds the tab', () => {
  it('keeps the words when a mounted screen that once showed the tab shows another tab now', async () => {
    act(() => { first = create(createElement(ScreenA)) })
    act(() => a!.setComposerText(TEXT))
    let origin: MobileNativeChatSendOrigin | null = null
    act(() => {
      origin = a!.captureSendOrigin(TEXT)
      a!.clearDraftForSend(origin!, TEXT)
    })
    await settle()
    const restore = a!.restoreRejectedDraft
    act(() => first!.unmount())
    first = null
    await settle()
    // The user reopens the tab, types a note, then switches the same screen to another tab.
    act(() => { second = create(createElement(ScreenX, { tabId: 'tab-s' })) })
    await settle()
    act(() => x!.setComposerText('note'))
    await settle(100)
    act(() => second!.update(createElement(ScreenX, { tabId: 'tab-o' })))
    await settle(100)
    expect(await readNativeChatDraft(KEY)).toBe('note')
    // The send from the closed screen is refused now.
    act(() => restore(origin!, TEXT))
    await settle(100)
    const storedRightAfter = await readNativeChatDraft(KEY)
    // Back to the tab.
    act(() => second!.update(createElement(ScreenX, { tabId: 'tab-s' })))
    await settle(150)
    const shown = x!.composerText
    const storedLater = await readNativeChatDraft(KEY)
    expect({ storedRightAfter, shown, storedLater }).toEqual({
      storedRightAfter: expect.stringContaining(TEXT),
      shown: expect.stringContaining(TEXT),
      storedLater: expect.stringContaining(TEXT)
    })
  })
})
