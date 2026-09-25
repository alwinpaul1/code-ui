import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined)
  }
}))

function ok(result: unknown) {
  return { ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function snapshotEvent(): AgentSessionSubscribeEvent {
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

/**
 * The background-tasks sheet voids what its Stop returns, and the task row
 * keeps its Stop button until the host says the task ended. So a Stop whose
 * outcome is unknown, and that says nothing, is a dead button on a task that
 * may still be running. A host refusal already said why (through the shared
 * mutation); an unknown outcome said nothing. Found by the sweep after the
 * chat Stop fix (2026-09-25).
 */
describe('a background task Stop that may not have landed says so', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  let listener: ((value: unknown) => void) | null = null
  let cancelReply: () => Promise<unknown> = async () => ok({})
  const onSendError = vi.fn()
  const sendRequest = vi.fn()
  const subscribe = vi.fn((_method: string, _params: unknown, onData: (value: unknown) => void) => {
    listener = onData
    return vi.fn()
  })
  const client = { sendRequest, subscribe } as unknown as RpcClient

  function Harness(): null {
    hook = useMobileStructuredAgentSession({
      client,
      sessionId: 'session-1',
      sourceIdentity: 'host-a\0workspace-a',
      enabled: true,
      connected: true,
      agent: 'claude',
      onSendError
    } as never)
    return null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    sendRequest.mockImplementation(async (method: string) => {
      if (method === 'agentSession.options') {
        return ok({ models: [], current: {} })
      }
      if (method === 'agentSession.cancel') {
        return cancelReply()
      }
      return ok({})
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
    listener = null
  })

  async function mountSession(): Promise<void> {
    act(() => {
      renderer = create(createElement(Harness))
    })
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(snapshotEvent()))
  }

  async function stopTask(): Promise<boolean | undefined> {
    let stopped: boolean | undefined
    await act(async () => {
      stopped = await hook?.stopBackgroundTask('task-1')
    })
    return stopped
  }

  function cancels() {
    return sendRequest.mock.calls.filter(([method]) => method === 'agentSession.cancel')
  }

  it('says the Stop is unconfirmed when its ack is lost', async () => {
    cancelReply = async () => {
      throw markRpcDeliveryUnknown(new Error('Connection closed'))
    }
    await mountSession()

    expect(await stopTask()).toBe(false)
    expect(cancels()).toHaveLength(1)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop unconfirmed — check chat before retrying')
  })

  it('says the Stop is unconfirmed when the host fails after taking it', async () => {
    cancelReply = async () => ({ ok: false, error: { code: 'runtime_error', message: 'failed' } })
    await mountSession()

    expect(await stopTask()).toBe(false)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop unconfirmed — check chat before retrying')
  })

  it('says why once when the host refuses the Stop', async () => {
    cancelReply = async () =>
      ok({ ok: false, refusal: { code: 'agent_session_not_found', message: 'That task has ended' } })
    await mountSession()

    expect(await stopTask()).toBe(false)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('That task has ended')
  })

  it('stays quiet when the host takes the Stop', async () => {
    cancelReply = async () =>
      ok({
        ok: true,
        replayed: false,
        fence: 3,
        cursor: { epoch: 'epoch-1', sequence: 1 },
        value: { cancelled: true }
      })
    await mountSession()

    expect(await stopTask()).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
  })
})
