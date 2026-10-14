import { beforeEach, describe, expect, it } from 'vitest'
import type { MobileSessionTab, SessionTabsResult } from '../session/mobile-session-route-types'
import {
  changeNativeChatOutbox,
  nativeChatOutboxEntries,
  resetNativeChatOutboxForTests
} from '../storage/native-chat-outbox'
import type { RpcClient } from '../transport/rpc-client'
import { replyToSessionFromNotification, type SessionReplyIo } from './session-reply-response'

const connected = { getState: () => 'connected' } as unknown as RpcClient
const DATA = { hostId: 'host-1', worktreeId: 'wt-1', paneKey: 'tab-1:leaf-1' }

function tab(agentStatus: unknown): MobileSessionTab {
  return {
    type: 'terminal',
    id: 'tab-1',
    title: 'claude',
    status: 'ready',
    terminal: 'term-9',
    isActive: true,
    ...(agentStatus === undefined ? {} : { agentStatus })
  } as unknown as MobileSessionTab
}

function io(tabUnderTest: MobileSessionTab): SessionReplyIo {
  return {
    now: () => 1_000,
    newId: () => 'send-1000-a',
    newOperationId: () => 'op',
    resolveClient: () => connected,
    hostCredential: async () => 'ready',
    readTabs: async () =>
      ({ worktree: 'wt-1', snapshotVersion: 1, tabs: [tabUnderTest], activeTabId: 'tab-1', activeTabType: 'terminal' }) as SessionTabsResult,
    readTranscript: async () => [],
    writeEntry: (entry) => changeNativeChatOutbox((current) => [...current, entry])
  }
}

beforeEach(() => {
  resetNativeChatOutboxForTests()
})

const SESSION = { agentType: 'claude', providerSession: { id: 'sess-1' } }

// The outbox drainer takes a prompt as a message's receipt only when it CHANGED from what the tab
// had when the message left (`route.promptBefore`, native-chat-outbox-headless.ts promptIsReceiptOf),
// and with no prompt-before known it trusts no prompt at all. The chat stamps the field only when
// the tab's status carries a prompt (use-mobile-native-chat-outbox.ts: undefined stays absent), so
// a reply from the shade must not turn "the status said nothing" into "the tab had no prompt".
describe('the prompt a reply’s route says the tab had', () => {
  it('is the prompt the tab’s status carried', async () => {
    await replyToSessionFromNotification({ userText: 'hi', data: DATA, io: io(tab({ ...SESSION, prompt: 'earlier' })) })
    expect(nativeChatOutboxEntries()[0]?.route?.promptBefore).toBe('earlier')
  })

  it('is kept when the prompt is the empty string', async () => {
    await replyToSessionFromNotification({ userText: 'hi', data: DATA, io: io(tab({ ...SESSION, prompt: '' })) })
    expect(nativeChatOutboxEntries()[0]?.route?.promptBefore).toBe('')
  })

  it('is left out when the status carries no prompt, so no prompt is trusted as the receipt', async () => {
    await replyToSessionFromNotification({ userText: 'hi', data: DATA, io: io(tab({ ...SESSION })) })
    const route = nativeChatOutboxEntries()[0]?.route
    expect(route).toBeDefined()
    expect(route).not.toHaveProperty('promptBefore')
  })
})
