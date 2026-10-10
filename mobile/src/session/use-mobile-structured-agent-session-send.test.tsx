import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalDispatchState } from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { structuredSendResultFixture } from './structured-agent-send-result.test-fixture'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

const asyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn()
}))

vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorage }))

function ok(result: unknown) {
  return { id: 'response', ok: true as const, result, _meta: { runtimeId: 'runtime-1' } }
}

function fieldsOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('expected an object')
  }
  return Object.fromEntries(Object.entries(value))
}

function sendResult(dispatchState: AgentJournalDispatchState) {
  return ok({
    ok: true,
    replayed: false,
    fence: 3,
    cursor: { epoch: 'epoch-1', sequence: 1 },
    value: structuredSendResultFixture(dispatchState)
  })
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
      window: {
        oldest: null,
        newest: null,
        nextCursor: { epoch: 'epoch-1', sequence: 0 }
      },
      liveCursor: { epoch: 'epoch-1', sequence: 0 },
      hasOlder: false,
      hasNewer: false
    }
  }
}

// Orca #26392: every Send is its own action under a fresh operation id. The journal that kept an
// id per text across presses (and relaunches) is gone, so an earlier press the host still holds
// as unknown can no longer answer for a later one.
describe('mobile structured send actions', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  let listener: ((value: unknown) => void) | null = null
  let storedOperations: Map<string, string>
  const onSendError = vi.fn()
  const sendRequest = vi.fn<RpcClient['sendRequest']>()
  const subscribe = vi.fn<RpcClient['subscribe']>((_method, _params, onData) => {
    listener = onData
    return vi.fn()
  })
  const client: RpcClient = {
    sendRequest,
    subscribe,
    updateTerminalSubscriptionViewport: () => {},
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    onStateChange: () => () => {},
    notifyForeground: () => {},
    close: () => {}
  }

  function Harness(): null {
    hook = useMobileStructuredAgentSession({
      client,
      sessionId: 'session-1',
      sourceIdentity: 'host-a\0workspace-a',
      enabled: true,
      connected: true,
      agent: 'codex',
      onSendError
    })
    return null
  }

  async function mountSession(): Promise<void> {
    act(() => {
      renderer = create(createElement(Harness))
    })
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(snapshotEvent()))
  }

  function calls() {
    return sendRequest.mock.calls.filter(([method]) => method === 'agentSession.send')
  }

  function sentIds(): string[] {
    return calls().map(([, params]) =>
      String(fieldsOf(fieldsOf(params).envelope).clientOperationId)
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    storedOperations = new Map()
    asyncStorage.getItem.mockImplementation(
      async (key: string) => storedOperations.get(key) ?? null
    )
    asyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
      storedOperations.set(key, value)
    })
    asyncStorage.removeItem.mockImplementation(async (key: string) => {
      storedOperations.delete(key)
    })
    sendRequest.mockImplementation(async (method) =>
      method === 'agentSession.options' ? ok({ models: [], current: {} }) : ok({})
    )
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
    listener = null
  })

  it.each(['unknown', 'pending', 'accepted'] as const)(
    'a later Send owns a new id even when the earlier host answer was %s',
    async (state) => {
      sendRequest.mockImplementation(async (method) =>
        method === 'agentSession.send' ? sendResult(state) : ok({ models: [], current: {} })
      )
      await mountSession()
      await act(async () => {
        const outcome = state === 'unknown' ? 'unknown' : 'accepted'
        expect(await hook!.sendWithOutcome('same text')).toBe(outcome)
        expect(await hook!.sendWithOutcome('same text')).toBe(outcome)
      })
      expect(new Set(sentIds()).size).toBe(2)
    }
  )

  it('sends the same words again after an acknowledgement was lost, and reports the new one as sent', async () => {
    let attempts = 0
    sendRequest.mockImplementation(async (method) => {
      if (method !== 'agentSession.send') {
        return ok({ models: [], current: {} })
      }
      attempts += 1
      if (attempts === 1) {
        throw markRpcDeliveryUnknown(new Error('Connection closed'))
      }
      return sendResult('accepted')
    })
    await mountSession()
    await act(async () => {
      expect(await hook!.sendWithOutcome('retry me')).toBe('unknown')
      expect(await hook!.sendWithOutcome('retry me')).toBe('accepted')
    })
    expect(new Set(sentIds()).size).toBe(2)
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('keeps the original unknown host row while allowing another Send', async () => {
    const original = structuredSendResultFixture('unknown')
    const event = snapshotEvent()
    event.page.submissions = [original.submission]
    event.page.items = [
      {
        itemId: 'original-message',
        revision: 1,
        sequence: 1,
        observedAt: 10,
        body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'same text' }] }
      }
    ]
    sendRequest.mockImplementation(async (method) =>
      method === 'agentSession.send' ? sendResult('accepted') : ok({ models: [], current: {} })
    )
    await mountSession()
    act(() => listener?.(event))
    const messages = hook!.session.messages
    expect(messages).toHaveLength(1)
    await act(async () => {
      expect(await hook!.sendWithOutcome('same text')).toBe('accepted')
    })
    expect(hook!.session.messages).toEqual(messages)
    expect(event.page.submissions[0]?.dispatchState).toBe('unknown')
    expect(calls()).toHaveLength(1)
  })

  it('does not replay an old action after remount', async () => {
    sendRequest.mockImplementation(async (method) => {
      if (method === 'agentSession.send') {
        throw markRpcDeliveryUnknown(new Error('Connection closed'))
      }
      return ok({ models: [], current: {} })
    })
    await mountSession()
    await act(async () => {
      expect(await hook!.sendWithOutcome('survive remount')).toBe('unknown')
    })
    act(() => renderer?.unmount())
    renderer = null
    listener = null
    await mountSession()
    await act(async () => {
      expect(await hook!.sendWithOutcome('survive remount')).toBe('unknown')
    })
    expect(new Set(sentIds()).size).toBe(2)
  })

  it('uses newly uploaded attachment paths for a new action with the same image', async () => {
    sendRequest.mockImplementation(async (method) =>
      method === 'agentSession.send' ? sendResult('unknown') : ok({ models: [], current: {} })
    )
    await mountSession()
    await act(async () => {
      for (const path of ['/tmp/original.png', '/tmp/reuploaded.png']) {
        expect(
          await hook!.sendWithOutcome('describe', undefined, undefined, [
            { path, previewUri: 'file:///photo.jpg' }
          ])
        ).toBe('unknown')
      }
    })
    expect(new Set(sentIds()).size).toBe(2)
    expect(calls()[1]?.[1]).toMatchObject({
      body: {
        blocks: expect.arrayContaining([{ type: 'image-ref', path: '/tmp/reuploaded.png' }])
      }
    })
  })

  it.each(['invalid_argument', 'unauthorized'])(
    'a later Send is independent after a %s refusal',
    async (code) => {
      let attempts = 0
      sendRequest.mockImplementation(async (method) => {
        if (method !== 'agentSession.send') {
          return ok({ models: [], current: {} })
        }
        return ++attempts === 1
          ? {
              id: 'request-1',
              ok: false as const,
              error: { code, message: 'Message is not authorized' }
            }
          : sendResult('accepted')
      })
      await mountSession()
      await act(async () => {
        expect(await hook!.sendWithOutcome('again')).toBe('rejected')
        expect(await hook!.sendWithOutcome('again')).toBe('accepted')
      })
      expect(new Set(sentIds()).size).toBe(2)
    }
  )

  it.each([
    ['agent_session_checkpoint_stale', 'Fence moved'],
    // The fork's #25149 port spent an expired retained id and said to check the chat; with no id
    // carried between presses an expired refusal is this press's own, and the next one goes.
    ['agent_session_operation_expired', 'Operation expired.']
  ])('a new Send goes through after a %s refusal', async (code, message) => {
    let attempts = 0
    sendRequest.mockImplementation(async (method) => {
      if (method !== 'agentSession.send') {
        return ok({ models: [], current: {} })
      }
      return ++attempts === 1
        ? ok({ ok: false, refusal: { code, message, currentFence: 3 } })
        : sendResult('accepted')
    })
    await mountSession()
    await act(async () => {
      expect(await hook!.sendWithOutcome('again')).toBe('rejected')
      expect(await hook!.sendWithOutcome('again')).toBe('accepted')
    })
    expect(new Set(sentIds()).size).toBe(2)
  })

  it('never reads an old phone journal, even when storage is full or unreadable', async () => {
    asyncStorage.getItem.mockRejectedValue(new Error('unreadable old journal'))
    asyncStorage.setItem.mockRejectedValue(new Error('disk full'))
    sendRequest.mockImplementation(async (method) =>
      method === 'agentSession.send' ? sendResult('accepted') : ok({ models: [], current: {} })
    )
    await mountSession()
    await act(async () => {
      expect(await hook!.sendWithOutcome('new action')).toBe('accepted')
    })
    expect(asyncStorage.getItem).not.toHaveBeenCalled()
    expect(asyncStorage.setItem).not.toHaveBeenCalled()
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('sends nothing once the action budget expires', async () => {
    await mountSession()
    await act(async () => {
      expect(await hook!.sendWithOutcome('never attempted', undefined, 0)).toBe('rejected')
    })
    expect(calls()).toHaveLength(0)
  })
})

// What the send bridge waits on while the relay re-dials. The controller has
// one structured lane, bound to the active tab, so the session a waiting send
// was tapped in has to be named, or a tab switch carries the text into the
// next tab's session (review of the 2026-09-25 relay wait).
describe('the send conditions a structured session hands the send bridge', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  let listener: ((value: unknown) => void) | null = null
  const client = {
    sendRequest: vi.fn(async (method: string) =>
      method === 'agentSession.options' ? ok({ models: [], current: {} }) : ok({})
    ),
    subscribe: vi.fn((_method: string, _params: unknown, onData: (value: unknown) => void) => {
      listener = onData
      return vi.fn()
    }),
    getState: () => 'connected'
  } as unknown as RpcClient

  function Harness({ sessionId, connected }: { sessionId: string; connected: boolean }): null {
    hook = useMobileStructuredAgentSession({
      client,
      sessionId,
      sourceIdentity: 'host-a\0workspace-a',
      enabled: true,
      connected,
      agent: 'codex',
      onSendError: vi.fn()
    } as never)
    return null
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
    listener = null
  })

  it('says the session has not loaded, not that it is disconnected, when a send beats its first page', async () => {
    const onSendError = vi.fn()
    function Early(): null {
      hook = useMobileStructuredAgentSession({
        client,
        sessionId: 'session-1',
        sourceIdentity: 'host-a\0workspace-a',
        enabled: true,
        connected: true,
        agent: 'codex',
        onSendError
      } as never)
      return null
    }
    act(() => {
      renderer = create(createElement(Early))
    })
    let outcome = 'accepted'
    await act(async () => {
      outcome = await hook!.sendWithOutcome('hello')
    })
    expect(outcome).toBe('rejected')
    expect(onSendError).toHaveBeenCalledWith(
      'Message not sent: the session on your desktop has not loaded yet'
    )
  })

  it('names the session a waiting send belongs to, and reads ready only once it loaded on a live link', async () => {
    act(() => {
      renderer = create(createElement(Harness, { sessionId: 'session-1', connected: true }))
    })
    // No fence to send against until the first page lands.
    expect(hook!.sendConditions.sendable).toBe(false)
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(snapshotEvent()))
    expect(hook!.sendConditions).toEqual({ client, target: expect.any(String), sendable: true })
    const tapped = hook!.sendConditions.target

    // The link drops: not sendable, but still the same session.
    act(() => {
      renderer!.update(createElement(Harness, { sessionId: 'session-1', connected: false }))
    })
    expect(hook!.sendConditions.sendable).toBe(false)
    expect(hook!.sendConditions.target).toBe(tapped)

    // Another tab's session is another target.
    act(() => {
      renderer!.update(createElement(Harness, { sessionId: 'session-2', connected: true }))
    })
    expect(hook!.sendConditions.target).not.toBe(tapped)
  })
})
