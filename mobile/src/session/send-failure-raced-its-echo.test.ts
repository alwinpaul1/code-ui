// S3 of docs/claude-app-parity-gaps.md: a failure that raced its echo is a success. The Claude app
// counts a POST that failed after its echo arrived as sent. The phone's body write can be refused
// or answered with an error after its bytes reached the agent; if Claude's own record (its row,
// or its prompt copy) already shows the message, "Message not sent" with the words back in the
// composer invites the user to send it a second time.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendWithOutcome = vi.fn()
vi.mock('./mobile-native-chat-send', () => ({
  sendMobileNativeChatMessageWithOutcome: (...args: unknown[]) => sendWithOutcome(...args),
  typeMobileNativeChatCommandWithOutcome: vi.fn(async () => 'accepted'),
  clearMobileNativeChatInput: vi.fn(async () => true),
  openMobileNativeChatSendBudget: () => Date.now() + 15_000,
  MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS: 15_000,
  MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS: 2_000
}))
vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))
vi.mock('./mobile-native-chat-screen-read', () => ({ readMobileNativeChatScreen: () => Promise.resolve(null) }))
vi.mock('../storage/native-chat-drafts', () => ({
  readNativeChatDraft: vi.fn(async () => null),
  writeNativeChatDraft: vi.fn(async () => undefined),
  appendNativeChatDraft: vi.fn(async (_key: string, next: (stored: string) => string) => next('')),
  openNativeChatDraftRead: vi.fn(async () => ({ current: () => null, close: () => undefined })),
  nativeChatDraftEpoch: () => 0
}))

import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { claimRowForSend } from '../storage/native-chat-send-claims'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import type { BeaconPromptReceipt } from './use-mobile-native-chat-beacon-confirm'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

describe('a body write that failed after Claude already had it', () => {
  let renderer: ReactTestRenderer | null = null
  let api: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  const origin = { draftKey: 'k', pendingKey: 'p', outboxId: 'send-1', normalizedText: 'deploy it' } as MobileNativeChatSendOrigin
  const restoreRejectedDraft = vi.fn()
  const acceptSend = vi.fn()
  const holdUnconfirmedSend = vi.fn()
  const onSendError = vi.fn()

  function mount(agent: 'claude' | 'codex', onRecord: boolean): void {
    function Probe(): null {
      api = useMobileNativeChatMessageSend({
        client: { sendRequest: vi.fn(), getState: () => 'connected', notifyForeground: vi.fn() } as never,
        enabled: true,
        handleRef: { current: 'term' },
        deviceTokenRef: { current: 'device' },
        agentRef: { current: agent },
        commandSendRef: { current: () => {} },
        captureSendOrigin: () => origin,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: vi.fn(),
        restoreRejectedDraft,
        acceptSend,
        holdUnconfirmedSend,
        onSendError,
        sendOnRecord: () => onRecord,
        refuseUnderDialog: async () => null
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
  }

  beforeEach(() => {
    sendWithOutcome.mockReset()
    sendWithOutcome.mockResolvedValue('rejected')
    restoreRejectedDraft.mockReset()
    acceptSend.mockReset()
    holdUnconfirmedSend.mockReset()
    onSendError.mockReset()
    resetMobileNativeChatTerminalWritesForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    api = null
  })

  for (const agent of ['claude', 'codex'] as const) {
    it(`counts it sent, with no "Message not sent" and the words kept out of the composer (${agent})`, async () => {
      mount(agent, true)
      let outcome: string | undefined
      await act(async () => {
        outcome = await api!.sendWithOutcome('deploy it')
      })
      expect(outcome).toBe('accepted')
      expect(restoreRejectedDraft).not.toHaveBeenCalled()
      expect(onSendError).not.toHaveBeenCalled()
      expect(acceptSend).toHaveBeenCalledWith(origin, 'deploy it', undefined)
    })

    it(`still says not sent and gives the words back when nothing of Claude's shows it (${agent})`, async () => {
      mount(agent, false)
      let outcome: string | undefined
      await act(async () => {
        outcome = await api!.sendWithOutcome('deploy it')
      })
      expect(outcome).toBe('rejected')
      expect(restoreRejectedDraft).toHaveBeenCalledWith(origin, 'deploy it')
      // With a Retry, as the Claude app's snackbar offers (pending-dim-ends-at-send-ack.test.ts).
      expect(onSendError).toHaveBeenCalledWith('Message not sent', { retry: true })
    })
  }
})

describe('whether Claude’s record already shows a send whose write failed', () => {
  let renderer: ReactTestRenderer | null = null
  let state: ReturnType<typeof useMobileNativeChatDrafts> | null = null

  function Harness({ messages, receipts }: { messages: NativeChatMessage[]; receipts?: readonly BeaconPromptReceipt[] }): null {
    state = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'tab',
      sessionId: 'session',
      messages,
      launchDraft: null,
      chatActive: true,
      transcriptLoading: false,
      transcriptSettled: true,
      ...(receipts ? { beaconPromptReceipts: receipts } : {})
    })
    return null
  }
  const show = async (messages: NativeChatMessage[], receipts?: readonly BeaconPromptReceipt[]) => {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, { messages, ...(receipts ? { receipts } : {}) }))
      } else {
        renderer = create(createElement(Harness, { messages, ...(receipts ? { receipts } : {}) }))
      }
    })
  }

  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
    await clearNativeChatDraftStores()
  })

  it('reads its row after its boundary, or Claude’s copy taken after it left, as on record', async () => {
    await show([user('r0', 'deploy it')], [{ nonce: 'n0', text: 'deploy it' }])
    const origin = state!.captureSendOrigin('deploy it')!
    // Only the copies and rows older than the send: not this send.
    expect(state!.sendOnRecord(origin, 'deploy it')).toBe(false)
    await show([user('r0', 'deploy it'), user('r1', 'deploy it')], [{ nonce: 'n0', text: 'deploy it' }])
    expect(state!.sendOnRecord(origin, 'deploy it')).toBe(true)
  })

  it('reads Claude’s new prompt copy as on record with no row yet', async () => {
    await show([])
    const origin = state!.captureSendOrigin('deploy it')!
    await show([], [{ nonce: 'n1', text: 'deploy it' }])
    expect(state!.sendOnRecord(origin, 'deploy it')).toBe(true)
  })

  it('does not take a row another send of the same words already settled', async () => {
    await show([])
    const origin = state!.captureSendOrigin('deploy it')!
    claimRowForSend('send-other', 'r1')
    await show([user('r1', 'deploy it')])
    expect(state!.sendOnRecord(origin, 'deploy it')).toBe(false)
  })
})
