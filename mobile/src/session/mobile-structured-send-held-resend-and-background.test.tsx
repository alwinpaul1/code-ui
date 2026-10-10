// Orca #26392 against this fork's own send path. Upstream: a phone Send whose acknowledgement was
// lost kept its operation id in a journal keyed by the text, so every later Send of the same
// words replayed it and the host answered with the first attempt's unresolved row: "Delivery
// unconfirmed" for good. Each Send is a new action now.
//
// The fork holds an ack-lost send as unconfirmed for 20 s of FOREGROUND time
// (mobile-native-chat-unconfirmed-hold.ts, app-foreground-clock.ts), and gives a failed send's
// words back to the composer (#25149). These drive the real draft store, the real structured
// session hook, the real send bridge and the real send module together against a desktop that
// keeps a ledger, to pin that letting the next Send go breaks neither.
//
// The last case found an older defect (review, 2026-10-10): the hook refused a spent budget
// with a bare "Message not sent" before the send module's background wording could run.

import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { noteAppForeground, resetAppForegroundClockForTests } from './app-foreground-clock'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { resetLiveNativeChatDraftsForTests } from './mobile-native-chat-live-drafts'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { structuredSendResultFixture } from './structured-agent-send-result.test-fixture'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'
import { useMobileStructuredNativeChatSendBridge } from './use-mobile-structured-native-chat-send-bridge'

const TEXT = 'please continue'
const UNCONFIRMED = 'Delivery unconfirmed — check chat before retrying'

function ok(result: unknown) {
  return { id: 'response', ok: true as const, result }
}

function fieldsOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('expected an object')
  }
  return Object.fromEntries(Object.entries(value))
}

function snapshotEvent(): Extract<AgentSessionSubscribeEvent, { type: 'snapshot' }> {
  return {
    type: 'snapshot',
    sessionId: 'session-1',
    fence: 3,
    page: {
      sessionId: 'session-1',
      epoch: 'epoch-1',
      fence: 3,
      direction: 'tail',
      items: [],
      removedItemIds: [],
      submissions: [],
      window: { oldest: null, newest: null, nextCursor: { epoch: 'epoch-1', sequence: 0 } },
      liveCursor: { epoch: 'epoch-1', sequence: 0 },
      hasOlder: false,
      hasNewer: false
    }
  }
}

/** A desktop that delivers the first send and loses its answer on the way back. Like the host's
 *  ledger, a request under an id it has already recorded is answered from the record and never
 *  delivered again, so a reused id can only replay the first attempt's unknown. */
function desktop(): { client: RpcClient; ids: string[]; delivered: string[] } {
  const ids: string[] = []
  const delivered: string[] = []
  const ledger = new Set<string>()
  let listener: ((value: unknown) => void) | null = null
  const sendRequest = vi.fn<RpcClient['sendRequest']>(async (method, params) => {
    if (method !== 'agentSession.send') {
      return ok(method === 'agentSession.options' ? { models: [], current: {} } : {})
    }
    const id = String(fieldsOf(fieldsOf(params).envelope).clientOperationId)
    ids.push(id)
    const replayed = ledger.has(id)
    if (!replayed) {
      ledger.add(id)
      delivered.push(id)
      if (delivered.length === 1) {
        throw markRpcDeliveryUnknown(new Error('relay RPC timed out: agentSession.send'))
      }
    }
    const value = structuredSendResultFixture(id === delivered[0] ? 'unknown' : 'accepted')
    return ok({ ok: true, replayed, fence: 3, cursor: { epoch: 'epoch-1', sequence: 1 }, value })
  })
  const client: RpcClient = {
    sendRequest,
    subscribe: vi.fn<RpcClient['subscribe']>((_method, _params, onData) => {
      listener = onData
      // The session's first page arrives once the subscription is up.
      queueMicrotask(() => listener?.(snapshotEvent()))
      return vi.fn()
    }),
    updateTerminalSubscriptionViewport: () => {},
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => 1,
    onStateChange: () => () => {},
    notifyForeground: () => {},
    close: () => {}
  }
  return { client, ids, delivered }
}


function userRow(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: Date.now(), source: 'transcript' }
}

describe('a structured-session Send after a held, refused or backgrounded one', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let bridge: ReturnType<typeof useMobileStructuredNativeChatSendBridge> | null = null
  let session: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  let setMessages: ((m: NativeChatMessage[]) => void) | null = null
  const errors: string[] = []

  beforeEach(() => {
    errors.length = 0
    resetAppForegroundClockForTests()
    vi.useFakeTimers()
  })
  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
    resetLiveNativeChatDraftsForTests()
    resetAppForegroundClockForTests()
    await clearNativeChatDraftStores()
  })

  async function mount(client: RpcClient): Promise<void> {
    function ChatScreen(): null {
      const [messages, set] = useState<NativeChatMessage[]>([])
      setMessages = set
      const onSendError = (message: string): void => { errors.push(message) }
      drafts = useMobileNativeChatDrafts({ hostId: 'h', worktreeId: 'w', tabId: 'tab-a', sessionId: 'session-1', messages, transcriptSettled: true })
      session = useMobileStructuredAgentSession({ client, sessionId: 'session-1', sourceIdentity: 'host-a\0workspace-a', enabled: true, connected: true, agent: 'claude', onSendError })
      bridge = useMobileStructuredNativeChatSendBridge({
        agent: 'claude', sendStructured: session.sendWithOutcome, sendConditions: session.sendConditions,
        captureSendOrigin: drafts.captureSendOrigin, clearDraftForSend: drafts.clearDraftForSend, acceptSend: drafts.acceptSend,
        holdUnconfirmedSend: drafts.holdUnconfirmedSend, restoreRejectedDraft: drafts.restoreRejectedDraft, onSendError
      })
      return null
    }
    act(() => { renderer = create(createElement(ChatScreen)) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(session!.sendConditions.sendable).toBe(true)
  }
  async function typeAndSend(text: string, deadline?: number): Promise<string> {
    await act(async () => { drafts!.setComposerText(text) })
    let outcome = ''
    await act(async () => { outcome = await bridge!.sendWithOutcome(text, undefined, deadline) })
    return outcome
  }
  async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  it('one transcript row after a held send and an accepted resend of the same words leaves no ghost bubble and no false "unconfirmed"', async () => {
    const tab = desktop()
    await mount(tab.client)
    expect(await typeAndSend(TEXT)).toBe('unknown')
    expect(await typeAndSend(TEXT)).toBe('accepted')
    expect(drafts!.pending.length).toBe(1)
    await act(async () => { setMessages!([userRow('u1', TEXT)]) })
    await advance(25_000)
    expect(drafts!.pending).toEqual([])
    expect(errors).toEqual([])
  })

  it('two transcript rows (both delivered) retire both, no ghost and no unconfirmed', async () => {
    const tab = desktop()
    await mount(tab.client)
    expect(await typeAndSend(TEXT)).toBe('unknown')
    expect(await typeAndSend(TEXT)).toBe('accepted')
    await act(async () => { setMessages!([userRow('u1', TEXT), userRow('u2', TEXT)]) })
    await advance(25_000)
    expect(drafts!.pending).toEqual([])
    expect(errors).toEqual([])
  })

  it('a refused send puts the words back in the composer and the next Send of them goes', async () => {
    let n = 0
    const tab = desktop()
    const base = tab.client.sendRequest
    tab.client.sendRequest = (async (method: string, params: unknown, opts: unknown) => {
      if (method === 'agentSession.send' && n++ === 0) {
        return ok({ ok: false, refusal: { code: 'agent_session_operation_expired', message: 'expired' } })
      }
      return (base as (...a: unknown[]) => unknown)(method, params, opts)
    }) as RpcClient['sendRequest']
    await mount(tab.client)
    expect(await typeAndSend(TEXT)).toBe('rejected')
    expect(drafts!.composerText).toBe(TEXT)
    expect(errors.length).toBe(1)
  })

  it('a send whose budget the background spent says the app was in the background and returns the words', async () => {
    const tab = desktop()
    await mount(tab.client)
    const start = Date.now()
    const deadline = start + 15_000
    noteAppForeground(false, start + 100)
    vi.setSystemTime(start + 14_500)
    noteAppForeground(true, start + 14_500)
    expect(await typeAndSend(TEXT, deadline)).toBe('rejected')
    expect(tab.ids).toHaveLength(0)
    expect(drafts!.composerText).toBe(TEXT)
    expect(errors).toEqual(['Message not sent: the app was in the background before it reached your desktop. Send it again'])
  })
})
