import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
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

const MODELS = {
  models: [
    { id: 'gpt-fast', label: 'GPT Fast', isDefault: true, defaultEffort: 'low', efforts: [] },
    { id: 'gpt-slow', label: 'GPT Slow', isDefault: false, defaultEffort: 'high', efforts: [] }
  ],
  current: { model: 'gpt-fast' }
}

const REFUSAL = 'Another client holds this session'
// What the phone says for it: the refusal's code worded through the shared notice table, never
// the host's own message (Orca #22999). `agent_session_conflict` names no cause of its own.
const SAID = "The setting wasn't changed."

/**
 * The session-option drawer draws in its own native window, over the chat's
 * banner, so a pick made from it hands in its own reporter and the host's
 * refusal is said in the drawer (MobileNativeChatSessionOptionPickers.failure.test.tsx).
 * The shared mutation said every refusal on the banner, where nobody could see
 * it while the drawer was open (2026-09-25).
 */
describe('a structured option change the host refuses', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  let listener: ((value: unknown) => void) | null = null
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
      agent: 'codex',
      onSendError
    } as never)
    return null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    sendRequest.mockImplementation(async (method: string) => {
      if (method === 'agentSession.options') {
        return ok(MODELS)
      }
      if (method === 'agentSession.setOption') {
        return ok({ ok: false, refusal: { code: 'agent_session_conflict', message: REFUSAL } })
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
    await vi.waitFor(() => expect(hook!.optionSnapshot.length).toBeGreaterThan(0))
  }

  async function pick(report?: (message: string) => void): Promise<boolean | undefined> {
    let applied: boolean | undefined
    await act(async () => {
      applied = await hook!.setStructuredOption('model', 'gpt-slow', report)
    })
    return applied
  }

  it('is said through the pick that asked for it', async () => {
    await mountSession()
    const say = vi.fn()

    expect(await pick(say)).toBe(false)

    expect(say).toHaveBeenCalledTimes(1)
    expect(say).toHaveBeenCalledWith(SAID)
    expect(onSendError).not.toHaveBeenCalled()
  })

  it("is said on the chat's banner when the change brought no reporter", async () => {
    await mountSession()

    expect(await pick()).toBe(false)

    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith(SAID)
  })
})
