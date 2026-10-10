import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { structuredSendResultFixture } from './structured-agent-send-result.test-fixture'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

const asyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => undefined),
  removeItem: vi.fn(async () => undefined)
}))

vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorage }))

const RUNNING = 'Not sent — a chat-session command is still running.'

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
 * While a chat-session command such as /compact is running (its RPC is
 * allowed up to 195 s), the structured lane turns every send away, a plain
 * message included. It used to do that without a word: the bridge put the
 * text back in the composer and nothing said why, so Send looked broken for as
 * long as the command ran. Found by the sweep after the Stop fix (2026-09-25).
 */
describe('a structured send turned away while a command runs says so', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  let listener: ((value: unknown) => void) | null = null
  let finishCommand: (() => void) | null = null
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
    finishCommand = null
    sendRequest.mockImplementation(async (method: string) => {
      if (method === 'agentSession.options') {
        return ok({ models: [], current: {}, conversationCommands: ['clear', 'compact'] })
      }
      if (method === 'agentSession.conversationCommand') {
        // The command runs until the test lets it finish.
        return new Promise((resolve) => {
          finishCommand = () =>
            resolve(ok({ ok: true, value: { command: 'compact', state: 'completed' } }))
        })
      }
      if (method === 'agentSession.send') {
        return ok({
          ok: true,
          replayed: false,
          fence: 3,
          cursor: { epoch: 'epoch-1', sequence: 1 },
          value: structuredSendResultFixture('accepted')
        })
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
    await vi.waitFor(() => expect(hook?.conversationCommands).toEqual(['clear', 'compact']))
  }

  function sends() {
    return sendRequest.mock.calls.filter(([method]) => method === 'agentSession.send')
  }

  /** Wrapped, not returned bare: an async function adopts a returned promise,
   *  so awaiting this would wait for the command the test has yet to finish. */
  async function startCompact(): Promise<{ compact: Promise<string> | undefined }> {
    let compact: Promise<string> | undefined
    await act(async () => {
      compact = hook?.sendWithOutcome('/compact')
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(finishCommand).toEqual(expect.any(Function)))
    return { compact }
  }

  it('says a message was not sent while /compact is still running', async () => {
    await mountSession()
    const { compact } = await startCompact()

    let outcome: string | undefined
    await act(async () => {
      outcome = await hook?.sendWithOutcome('hello there')
    })

    expect(outcome).toBe('rejected')
    expect(sends()).toHaveLength(0)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith(RUNNING)
    await act(async () => {
      finishCommand?.()
      await compact
    })
  })

  it('says a second command was not sent while the first is still running', async () => {
    await mountSession()
    const { compact } = await startCompact()

    let outcome: string | undefined
    await act(async () => {
      outcome = await hook?.sendWithOutcome('/clear')
    })

    expect(outcome).toBe('rejected')
    expect(
      sendRequest.mock.calls.filter(([method]) => method === 'agentSession.conversationCommand')
    ).toHaveLength(1)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith(RUNNING)
    await act(async () => {
      finishCommand?.()
      await compact
    })
  })

  it('sends the message once the command has finished, and says nothing', async () => {
    await mountSession()
    const { compact } = await startCompact()
    await act(async () => {
      finishCommand?.()
      await compact
    })

    let outcome: string | undefined
    await act(async () => {
      outcome = await hook?.sendWithOutcome('hello there')
    })

    expect(outcome).not.toBe('rejected')
    expect(sends()).toHaveLength(1)
    expect(onSendError).not.toHaveBeenCalled()
  })
})
