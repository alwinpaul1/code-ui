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

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { noteAppForeground, resetAppForegroundClockForTests } from './app-foreground-clock'
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

describe('another Send after a structured send was left unconfirmed', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: ReturnType<typeof useMobileNativeChatDrafts> | null = null
  let bridge: ReturnType<typeof useMobileStructuredNativeChatSendBridge> | null = null
  let session: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  const errors: string[] = []

  beforeEach(() => {
    errors.length = 0
    resetAppForegroundClockForTests()
    vi.useFakeTimers()
  })

  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    drafts = null
    bridge = null
    session = null
    vi.useRealTimers()
    resetLiveNativeChatDraftsForTests()
    resetAppForegroundClockForTests()
    await clearNativeChatDraftStores()
  })

  async function mount(client: RpcClient): Promise<void> {
    function ChatScreen(): null {
      const onSendError = (message: string): void => {
        errors.push(message)
      }
      drafts = useMobileNativeChatDrafts({
        hostId: 'h',
        worktreeId: 'w',
        tabId: 'tab-a',
        sessionId: 'session-1',
        messages: [],
        transcriptSettled: true
      })
      session = useMobileStructuredAgentSession({
        client,
        sessionId: 'session-1',
        sourceIdentity: 'host-a\0workspace-a',
        enabled: true,
        connected: true,
        agent: 'claude',
        onSendError
      })
      bridge = useMobileStructuredNativeChatSendBridge({
        agent: 'claude',
        sendStructured: session.sendWithOutcome,
        sendConditions: session.sendConditions,
        captureSendOrigin: drafts.captureSendOrigin,
        clearDraftForSend: drafts.clearDraftForSend,
        acceptSend: drafts.acceptSend,
        holdUnconfirmedSend: drafts.holdUnconfirmedSend,
        restoreRejectedDraft: drafts.restoreRejectedDraft,
        onSendError
      })
      return null
    }
    act(() => {
      renderer = create(createElement(ChatScreen))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(session!.sendConditions.sendable).toBe(true)
  }

  async function typeAndSend(text: string): Promise<string> {
    await act(async () => {
      drafts!.setComposerText(text)
    })
    let outcome = ''
    await act(async () => {
      outcome = await bridge!.sendWithOutcome(text)
    })
    return outcome
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('sends the same words again under a new id, and the desktop takes them', async () => {
    const tab = desktop()
    await mount(tab.client)

    expect(await typeAndSend(TEXT)).toBe('unknown')
    expect(drafts!.composerText).toBe('')
    await advance(20_500)
    expect(errors).toEqual([UNCONFIRMED])

    expect(await typeAndSend(TEXT)).toBe('accepted')

    // Two presses, two actions, both delivered; the second was never a replay of the first.
    expect(tab.delivered).toHaveLength(2)
    expect(new Set(tab.ids).size).toBe(2)
    // Taken, so nothing more is said and nothing goes back into the composer.
    expect(errors).toEqual([UNCONFIRMED])
    expect(drafts!.composerText).toBe('')
  })

  it('lets the next Send go after the app was away, and says neither "not sent" nor "unconfirmed" early', async () => {
    const tab = desktop()
    await mount(tab.client)

    expect(await typeAndSend(TEXT)).toBe('unknown')
    // The hold's deadline comes due while the app is away (no JS timer runs), and the app comes back.
    await advance(18_900)
    noteAppForeground(false)
    vi.setSystemTime(Date.now() + 60_000)
    noteAppForeground(true)
    await advance(500)
    expect(errors).toEqual([])

    // Back in the app, the same words go again at once: a new action, not the held one's replay.
    expect(await typeAndSend(TEXT)).toBe('accepted')
    expect(tab.delivered).toHaveLength(2)
    expect(new Set(tab.ids).size).toBe(2)
    expect(errors).toEqual([])
    expect(drafts!.composerText).toBe('')

    // The first send still gets its full 20 s of foreground time before it says anything.
    await advance(18_500)
    expect(errors).toEqual([])
    await advance(1_500)
    expect(errors).toEqual([UNCONFIRMED])
  })
})
