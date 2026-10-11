// S1 of docs/claude-app-parity-gaps.md: one id per send, and the row that settled a send is
// written down under that id, so two sends of the same words can never settle each other.
//
// The terminal lane has no wire id (Claude Code writes its own uuid into the transcript), so a
// send is matched to its row by its words. Before this, every check matched on its own: the
// first "yes"'s row also proved a second "yes" delivered, and a second that never arrived left
// the outbox with nobody to send it.

import { createElement } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import {
  claimNonceForSend,
  claimRowForSend,
  hydrateNativeChatSendClaims,
  nativeChatSendClaimWritesSettled,
  resetNativeChatSendClaimsForTests,
  rowClaimant
} from '../storage/native-chat-send-claims'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { outboxEchoId } from './mobile-native-chat-outbox-drafts'
import { outboxEntryLanding } from './native-chat-outbox-recovery-plan'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import type { BeaconPromptReceipt } from './use-mobile-native-chat-beacon-confirm'

vi.mock('../storage/native-chat-drafts', () => ({
  readNativeChatDraft: vi.fn(async () => null),
  writeNativeChatDraft: vi.fn(async () => undefined)
}))

type DraftState = ReturnType<typeof useMobileNativeChatDrafts>

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

function assistant(id: string, text: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

describe('one id per send', () => {
  let renderer: ReactTestRenderer | null = null
  let state: DraftState | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    resetNativeChatSendClaimsForTests()
  })

  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
    vi.useRealTimers()
    await clearNativeChatDraftStores()
    resetNativeChatSendClaimsForTests()
  })

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

  async function mount(messages: NativeChatMessage[], receipts?: readonly BeaconPromptReceipt[]): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { messages, ...(receipts ? { receipts } : {}) }))
    })
  }

  async function show(messages: NativeChatMessage[], receipts?: readonly BeaconPromptReceipt[]): Promise<void> {
    await act(async () => {
      renderer!.update(createElement(Harness, { messages, ...(receipts ? { receipts } : {}) }))
    })
  }

  async function hold(text: string, onUnconfirmed: () => void): Promise<string> {
    const origin = state!.captureSendOrigin(text)!
    await act(async () => {
      state!.holdUnconfirmedSend(origin, text, onUnconfirmed)
    })
    return origin.outboxId!
  }

  it('draws a photo send’s bubble under its outbox entry’s own id', async () => {
    await mount([])
    const origin = state!.captureSendOrigin('look at this')!
    let echoId: string | null = null
    act(() => {
      echoId = state!.acceptSend(origin, 'look at this', ['file:///a.jpg'], ['/tmp/a.jpg'])
    })
    expect(origin.outboxId).toBeDefined()
    expect(echoId).toBe(outboxEchoId(origin.outboxId!))
    expect(state!.pending.map((item) => item.id)).toEqual([outboxEchoId(origin.outboxId!)])
  })

  it('keeps a second ack-lost "yes" unconfirmed after the first one’s row settled the first', async () => {
    await mount([])
    const first = vi.fn()
    const second = vi.fn()
    await hold('yes', first)
    vi.advanceTimersByTime(10)
    await hold('yes', second)
    // One row lands: the first send's.
    await show([user('r1', 'yes')])
    // Anything else that makes the chat look again (the reply streaming in).
    await show([user('r1', 'yes'), assistant('a1', 'Done.')])
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('gives the row to an earlier send of the same words still waiting for it, not to a later ack-lost one', async () => {
    await mount([])
    // The first was taken on Claude's own receipt: its bubble waits for the row, with no hold.
    const firstOrigin = state!.captureSendOrigin('yes')!
    act(() => {
      state!.acceptSend(firstOrigin, 'yes')
    })
    vi.advanceTimersByTime(10)
    const second = vi.fn()
    await hold('yes', second)
    await show([user('r1', 'yes')])
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(second).toHaveBeenCalledTimes(1)
    expect(rowClaimant('r1')).not.toBe(undefined)
  })

  it('writes down the row that retired a bubble, under the send’s id', async () => {
    await mount([])
    const origin = state!.captureSendOrigin('yes')!
    act(() => {
      state!.acceptSend(origin, 'yes')
    })
    await show([user('r1', 'yes')])
    expect(state!.pending).toEqual([])
    expect(rowClaimant('r1')).toBe(origin.outboxId)
  })

  it('does not let a receipt another send already took confirm an ack-lost send of the same words', async () => {
    await mount([])
    const second = vi.fn()
    await hold('yes', second)
    // An earlier "yes" was verified on this receipt; it reached the phone after the second left.
    claimNonceForSend('send-earlier', 'n1')
    await show([], [{ nonce: 'n1', text: 'yes' }])
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('a message the app was closed under, against rows other sends settled', () => {
  beforeEach(() => resetNativeChatSendClaimsForTests())
  afterEach(() => resetNativeChatSendClaimsForTests())

  const entry = (overrides: Partial<NativeChatOutboxEntry> = {}): NativeChatOutboxEntry => ({
    id: 'send-second',
    draftKey: 'h\0w\0t',
    pendingKey: 'h\0w\0t\0s',
    text: 'yes',
    normalizedText: 'yes',
    baselineOccurrences: 0,
    baselineTailMessageId: null,
    baselineResolved: true,
    createdAt: 1,
    operationId: 'op',
    autoAttempts: 0,
    ...overrides
  })

  it('reads it as missing when the only row of its words is the one an earlier send settled', () => {
    claimRowForSend('send-first', 'r1')
    expect(outboxEntryLanding(entry(), [user('r1', 'yes')], [])).toBe('missing')
    expect(outboxEntryLanding(entry(), [user('r1', 'yes'), user('r2', 'yes')], [])).toBe('landed')
    expect(rowClaimant('r2')).toBe('send-second')
  })

  it('reads it as missing when the only receipt of its words is one an earlier send took', () => {
    claimNonceForSend('send-first', 'n1')
    expect(outboxEntryLanding(entry(), [], [{ nonce: 'n1', text: 'yes' }])).toBe('missing')
  })

  it('still reads its own row as landed after it settled it once (a recount after a reload)', () => {
    claimRowForSend('send-second', 'r1')
    expect(outboxEntryLanding(entry(), [user('r1', 'yes')], [])).toBe('landed')
  })

  it('keeps what each row settled across a restart', async () => {
    claimRowForSend('send-first', 'r1')
    await nativeChatSendClaimWritesSettled()
    resetNativeChatSendClaimsForTests()
    expect(rowClaimant('r1')).toBe(undefined)
    await hydrateNativeChatSendClaims()
    expect(rowClaimant('r1')).toBe('send-first')
  })

  it('reads a store it cannot parse as no claims, and still claims in memory', async () => {
    await AsyncStorage.setItem('orca:chatSendClaims', '{not json')
    resetNativeChatSendClaimsForTests()
    await hydrateNativeChatSendClaims()
    expect(claimRowForSend('send-first', 'r1')).toBe(true)
    expect(claimRowForSend('send-second', 'r1')).toBe(false)
    expect(rowClaimant('r1')).toBe('send-first')
  })
})
