import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() }
}))

// What a person sees on the phone when an Orca 1.4.220 host refuses a chat for a reason it names.
// Orca #23674 (afa81dc3ad) throws such a refusal as `runtime_error` with the bare code as its
// message and the typed refusal in `error.data` (`mapRuntimeError`, src/main/runtime/rpc/errors.ts
// at v1.4.220): a journal SQLite reports damaged is `journalCorrupt`.
const THROWN_JOURNAL_REFUSAL = {
  code: 'runtime_error',
  message: 'agent_session_journal_unreadable',
  data: {
    refusal: { code: 'agent_session_journal_unreadable', details: { reason: 'journalCorrupt' } }
  }
}

function runningTurnSnapshot(): AgentSessionSubscribeEvent {
  return {
    type: 'snapshot',
    sessionId: 'session-1',
    fence: 3,
    page: {
      sessionId: 'session-1',
      epoch: 'epoch-1',
      fence: 3,
      direction: 'tail',
      items: [
        {
          itemId: 'turn-1',
          revision: 1,
          sequence: 1,
          observedAt: 10,
          body: { kind: 'status', text: 'Working', turnLifecycle: { turnId: 'turn-1', state: 'running' } }
        }
      ],
      removedItemIds: [],
      submissions: [],
      window: {
        oldest: { epoch: 'epoch-1', sequence: 1 },
        newest: { epoch: 'epoch-1', sequence: 1 },
        nextCursor: { epoch: 'epoch-1', sequence: 2 }
      },
      liveCursor: { epoch: 'epoch-1', sequence: 1 },
      hasOlder: false,
      hasNewer: false
    }
  }
}

describe('a chat the host refuses for a reason it names', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  let listener: ((value: unknown) => void) | null = null
  const onSendError = vi.fn()
  type SendRequest = (method: string, params?: unknown, options?: unknown) => Promise<unknown>
  const accepted: SendRequest = async () => ({
    id: 'req',
    ok: true,
    result: {},
    _meta: { runtimeId: 'runtime-1' }
  })
  const sendRequest = vi.fn<SendRequest>(accepted)
  const client = {
    sendRequest,
    subscribe: (_method: string, _params: unknown, onData: (value: unknown) => void) => {
      listener = onData
      return () => {}
    },
    getState: () => 'connected'
  } as unknown as RpcClient

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

  beforeEach(() => {
    vi.clearAllMocks()
    sendRequest.mockImplementation(accepted)
    listener = null
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  it("says the chat won't load in words, not the refusal's bare code, when its feed ends refused", async () => {
    act(() => {
      renderer = create(createElement(Harness))
    })
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))

    // The error frame the stream registry finishes a refused subscribe with.
    act(() =>
      listener?.({
        type: 'error',
        message: THROWN_JOURNAL_REFUSAL.message,
        error: THROWN_JOURNAL_REFUSAL
      })
    )

    expect(hook?.session.error).toBe('Unable to load this chat.')
  })

  it("says the chat won't load in words when the host refuses to hold it", async () => {
    sendRequest.mockImplementation(async (method: string) =>
      method === 'agentSession.hold'
        ? { id: 'req', ok: false, error: THROWN_JOURNAL_REFUSAL }
        : accepted(method)
    )
    act(() => {
      renderer = create(createElement(Harness))
    })

    await vi.waitFor(() => expect(hook?.session.error).toBeTruthy())
    expect(hook?.session.error).toBe('Unable to load this chat.')
  })

  it('says a refused Stop was not stopped, and why, instead of calling it unconfirmed', async () => {
    act(() => {
      renderer = create(createElement(Harness))
    })
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(runningTurnSnapshot()))
    sendRequest.mockImplementation(async (method: string) =>
      method === 'agentSession.cancel'
        ? { id: 'req', ok: false, error: THROWN_JOURNAL_REFUSAL }
        : accepted(method)
    )
    onSendError.mockClear()

    await act(async () => {
      hook!.cancel()
      await vi.waitFor(() => expect(onSendError).toHaveBeenCalled())
    })

    expect(onSendError).toHaveBeenCalledWith("Unable to load this chat. The agent wasn't stopped.")
  })
})
