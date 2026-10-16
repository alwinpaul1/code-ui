/**
 * A message whose send fails after the chat closed comes back in its tab's draft (found in the
 * queue review sweep, 2026-10-16). Both lanes give refused words back through ONE call, the drafts
 * hook's `restoreRejectedDraft`: the Anthropic lane's `sendNow` (use-ccr-composer-send.ts) and the
 * terminal lane's message send (use-mobile-native-chat-message-send.ts, the `stopped` and
 * `rejected` paths). It wrote through `liveNativeChatDrafts`, which falls back to the closed
 * screen's own React setter when no screen shows the tab, so the words went nowhere, and the
 * outbox entry that still held them had already been retired. Once no screen shows the tab, they
 * now go to its STORED draft, and the outbox entry stays retired: one copy, never two.
 *
 * Drives the REAL draft store and outbox; the Anthropic POST is a stub held open until it fails.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readNativeChatDraft } from '../storage/native-chat-drafts'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import type { CcrComposerSendDeps } from './ccr-composer-send-deps'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { recordOutboxSend, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { useCcrComposerSend } from './use-ccr-composer-send'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

const KEY = 'h\0w\0tab-s'
const TEXT = 'deploy it when the tests pass'

let renderer: ReactTestRenderer | null = null
let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
let ccr: ReturnType<typeof useCcrComposerSend> | null = null
let failPost: (error: Error) => void = () => undefined
const logs: string[] = []
const deps: CcrComposerSendDeps = {
  post: () => new Promise<void>((_resolve, reject) => { failPost = reject }),
  readStatus: async () => 'connected',
  log: (line) => logs.push(line),
  newUuid: () => 'uuid-1'
}

function ChatScreen({ withCcr }: { withCcr: boolean }): null {
  drafts = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId: 'tab-s', sessionId: 'session-s', messages: [], transcriptSettled: true })
  {
    ccr = useCcrComposerSend({
      active: withCcr,
      tabId: 'tab-s',
      resolveTarget: () => ({ kind: 'target', sessionId: 'cse_01FaTuRHkvnrgXpjd3nuGiQF', accountId: 'acct' }),
      events: [],
      connectionStatus: 'connected',
      working: false,
      promptUp: false,
      attachments: () => 0,
      composerText: drafts.composerText,
      setComposerText: drafts.setComposerText,
      captureSendOrigin: drafts.captureSendOrigin,
      clearDraftForSend: drafts.clearDraftForSend,
      acceptSend: drafts.acceptSend,
      restoreRejectedDraft: drafts.restoreRejectedDraft,
      returnQueueToDraft: drafts.returnQueueToDraft,
      removePending: drafts.removePending,
      onSendError: () => undefined,
      deps
    })
  }
  return null
}

function mount(withCcr: boolean): void {
  act(() => {
    renderer = create(createElement(ChatScreen, { withCcr }))
  })
}
function closeChat(): void {
  act(() => renderer?.unmount())
  renderer = null
}
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

beforeEach(() => {
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
  logs.length = 0
})
afterEach(async () => {
  closeChat()
  resetLiveNativeChatDraftsForTests()
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
  await clearNativeChatDraftStores()
  await AsyncStorage.clear()
})

describe('a message whose send fails after the chat closed', () => {
  it("comes back in its tab's stored draft through the restore both lanes call, and the outbox does not also keep it", async () => {
    mount(false)
    act(() => drafts!.setComposerText(TEXT))
    let origin: MobileNativeChatSendOrigin | null = null
    act(() => {
      origin = drafts!.captureSendOrigin(TEXT)
      drafts!.clearDraftForSend(origin!, TEXT)
    })
    expect(origin).not.toBeNull()
    await settle()
    const restore = drafts!.restoreRejectedDraft
    closeChat()
    await settle()
    act(() => restore(origin!, TEXT))
    await settle()
    expect(await readNativeChatDraft(KEY)).toBe(TEXT)
    expect(nativeChatOutboxEntries().filter((entry) => entry.text === TEXT)).toEqual([])
  })

  it("comes back in its tab's stored draft when an Anthropic-lane POST fails after the chat closed, with one copy only", async () => {
    mount(true)
    act(() => drafts!.setComposerText(TEXT))
    let outcome: Promise<string> = Promise.resolve('')
    act(() => { outcome = ccr!.sendWithOutcome(TEXT) })
    await settle()
    // Written to the outbox while it is out, so an app killed now resends it.
    expect(nativeChatOutboxEntries().map((entry) => entry.text)).toEqual([TEXT])
    closeChat()
    await settle()
    await act(async () => { failPost(new Error('HTTP 503')); await outcome })
    await settle()
    expect(await readNativeChatDraft(KEY)).toBe(TEXT)
    expect(nativeChatOutboxEntries().filter((entry) => entry.text === TEXT)).toEqual([])
  })

  it('a recovery resend refused after the chat closed stays in the outbox, marked failed, and is not also put in the draft', async () => {
    mount(false)
    let origin: MobileNativeChatSendOrigin | null = null
    act(() => { origin = drafts!.captureSendOrigin(TEXT) })
    expect(origin!.outboxId).toBeTruthy()
    recordOutboxSend(origin!, TEXT)
    origin!.outboxRecovery = true
    const restore = drafts!.restoreRejectedDraft
    closeChat()
    await settle()
    act(() => restore(origin!, TEXT))
    await settle()
    expect(await readNativeChatDraft(KEY)).toBeNull()
    expect(nativeChatOutboxEntries().filter((entry) => entry.text === TEXT).map((entry) => entry.failed)).toEqual([true])
  })
})
