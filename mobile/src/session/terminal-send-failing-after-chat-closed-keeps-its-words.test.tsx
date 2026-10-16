/**
 * A message whose terminal-lane send fails after the chat closed comes back in its tab's draft
 * (found in the queue review sweep, 2026-10-16). The terminal lane's message send gives refused
 * words back through the drafts hook's `restoreRejectedDraft` (use-mobile-native-chat-message-
 * send.ts, the `rejected` path), which wrote into the closed screen's own React state when no
 * screen showed the tab: the words were lost, and the outbox entry holding them was retired. They
 * now go to the tab's stored draft, and the outbox keeps no second copy.
 *
 * The REAL draft store and outbox, with the terminal write mocked as in
 * use-mobile-native-chat-message-send.test.ts and held open until it is refused.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'

let answer: (outcome: MobileNativeChatSendOutcome) => void = () => undefined
let writes = 0
vi.mock('./mobile-native-chat-send', () => ({
  sendMobileNativeChatMessageWithOutcome: () => new Promise<MobileNativeChatSendOutcome>((resolve) => { writes += 1; answer = resolve }),
  typeMobileNativeChatCommandWithOutcome: () => Promise.resolve('accepted'),
  clearMobileNativeChatInput: () => Promise.resolve(true),
  openMobileNativeChatSendBudget: () => Date.now() + 15_000,
  MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS: 15_000,
  MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS: 2_000
}))
vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))
const readScreen = vi.hoisted(() => vi.fn(() => Promise.resolve(null)))
vi.mock('./mobile-native-chat-screen-read', () => ({ readMobileNativeChatScreen: readScreen }))

import { readNativeChatDraft } from '../storage/native-chat-drafts'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'

const KEY = 'h\0w\0tab-s'
const TEXT = 'deploy it when the tests pass'

let renderer: ReactTestRenderer | null = null
let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
let api: ReturnType<typeof useMobileNativeChatMessageSend> | null = null

function ChatScreen(): null {
  drafts = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId: 'tab-s', sessionId: 'session-s', messages: [], transcriptSettled: true })
  api = useMobileNativeChatMessageSend({
    client: { sendRequest: vi.fn(), getState: () => 'connected', notifyForeground: vi.fn() } as never,
    enabled: true,
    handleRef: { current: 'term' },
    deviceTokenRef: { current: 'device' },
    agentRef: { current: 'codex' },
    commandSendRef: { current: () => undefined },
    captureSendOrigin: drafts.captureSendOrigin,
    readSeededLaunchDraftSeed: () => null,
    clearDraftForSend: drafts.clearDraftForSend,
    restoreRejectedDraft: drafts.restoreRejectedDraft,
    acceptSend: drafts.acceptSend,
    holdUnconfirmedSend: drafts.holdUnconfirmedSend,
    onSendError: () => undefined
  })
  return null
}
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

beforeEach(() => {
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
  resetMobileNativeChatTerminalWritesForTests()
})
afterEach(async () => {
  act(() => renderer?.unmount())
  renderer = null
  resetLiveNativeChatDraftsForTests()
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
  await clearNativeChatDraftStores()
  await AsyncStorage.clear()
})

describe('a message whose terminal-lane send fails after the chat closed', () => {
  it("comes back in its tab's stored draft, with no second copy left in the outbox", async () => {
    act(() => { renderer = create(createElement(ChatScreen)) })
    act(() => drafts!.setComposerText(TEXT))
    let outcome: Promise<unknown> = Promise.resolve()
    act(() => { outcome = api!.send(TEXT) })
    await settle()
    // The body write is out (and held) before the chat closes.
    expect(writes).toBe(1)
    act(() => renderer?.unmount())
    renderer = null
    await settle()
    await act(async () => { answer('rejected'); await outcome })
    await settle()
    expect(await readNativeChatDraft(KEY)).toBe(TEXT)
    expect(nativeChatOutboxEntries().filter((entry) => entry.text === TEXT)).toEqual([])
  })
})
