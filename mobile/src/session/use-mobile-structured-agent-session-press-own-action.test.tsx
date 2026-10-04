import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() }
}))

// The session hook hands the status probe's `agent-session.repeated-stop.v1` fact to /clear and
// /compact (Orca #24301): a press after a lost answer is its own action on a 1.4.220 host, and a
// replay of the same id on an older host or before the probe answers.
function idleSnapshot(): AgentSessionSubscribeEvent {
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

let renderer: ReactTestRenderer | null = null
let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
let listener: ((value: unknown) => void) | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  hook = null
  listener = null
})

type SendRequest = (method: string, params?: unknown, options?: unknown) => Promise<unknown>

async function pressClearTwice(repeatedStopSupported: boolean | null): Promise<string[]> {
  let commands = 0
  const sendRequest = vi.fn<SendRequest>(async (method) => {
    if (method === 'agentSession.conversationCommand') {
      commands += 1
      if (commands === 1) {
        throw markRpcDeliveryUnknown(new Error('Connection closed'))
      }
      return { ok: true, result: { ok: true, value: { command: 'clear', state: 'completed' } } }
    }
    if (method === 'agentSession.options') {
      return { ok: true, result: { models: [], conversationCommands: ['clear', 'compact'] } }
    }
    return { ok: true, result: {}, _meta: { runtimeId: 'runtime-1' } }
  })
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
      repeatedStopSupported,
      onSendError: vi.fn()
    })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
  await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
  act(() => listener?.(idleSnapshot()))
  await vi.waitFor(() => expect(hook?.conversationCommands).toContain('clear'))

  let first: unknown
  let second: unknown
  await act(async () => {
    first = await hook!.sendWithOutcome('/clear')
  })
  await act(async () => {
    second = await hook!.sendWithOutcome('/clear')
  })
  expect([first, second]).toEqual(['unknown', 'accepted'])
  return sendRequest.mock.calls
    .filter(([method]) => method === 'agentSession.conversationCommand')
    .map(([, params]) => (params as { envelope: { clientOperationId: string } }).envelope.clientOperationId)
}

describe('a /clear pressed again through the chat after its answer was lost', () => {
  it('goes out under a new id when the host advertises repeated-stop (1.4.220)', async () => {
    const [first, second] = await pressClearTwice(true)
    expect(second).not.toBe(first)
  })

  it.each([
    ['an older host', false],
    ['before the status probe answers', null]
  ] as const)('replays the same id for %s', async (_label, supported) => {
    const [first, second] = await pressClearTwice(supported)
    expect(second).toBe(first)
  })
})
