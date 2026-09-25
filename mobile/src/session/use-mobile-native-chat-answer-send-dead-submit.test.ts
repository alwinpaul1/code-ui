import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskPrompt } from '../../../src/shared/native-chat-ask'
import type { AgentType } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import {
  markMobileNativeChatInputStale,
  resetMobileNativeChatStaleInputForTests
} from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatAnswerSend } from './use-mobile-native-chat-answer-send'

type AnswerSend = ReturnType<typeof useMobileNativeChatAnswerSend>

function reply(accepted: boolean) {
  return {
    id: 'send',
    ok: true as const,
    result: { send: { accepted } },
    _meta: { runtimeId: 'r' }
  }
}

// The card that was reported (2026-09-25): one question, single-select.
const PUSH: AskPrompt = {
  questions: [
    {
      question: 'Push the branch?',
      header: 'Push',
      multiSelect: false,
      options: [{ label: 'Yes, push to PR 1100' }, { label: 'No, keep it local' }]
    }
  ]
}

const TWO_QUESTIONS: AskPrompt = {
  questions: [
    { question: 'q1', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
    { question: 'q2', multiSelect: false, options: [{ label: 'C' }, { label: 'D' }] }
  ]
}

const ROUTE = 'host\0worktree\0tab\0session\0terminal'
const ANOTHER_TAB = 'host\0worktree\0other-tab\0other\0other-terminal'

/**
 * "I picked an option and had to tap Submit twice" (device, 2026-09-25).
 *
 * The card re-enables whenever the answer resolves false, so a false result
 * that says nothing is a dead button: the first tap looks like it did
 * nothing, and the second one works. Every failed answer has to say so, except
 * one a newer answer took over, which reports for itself. Where the words
 * land (the composer's banner, or a toast once the chat has moved on) is
 * `use-mobile-native-chat-send-error.ts`'s call, not this hook's. Claude Code
 * itself takes the first option number (live on 2.1.281 and 2.1.282,
 * `claude-ask-answer-keys-screens.test.ts`), so the phone is where a first tap
 * can be lost.
 */
describe('a Submit tap that did nothing says so', () => {
  let renderer: ReactTestRenderer | null = null
  let answerSend: AnswerSend | null = null
  let mountedClient: RpcClient | null = null
  let mountedAgent: AgentType = 'claude'
  let onSendError = vi.fn()

  beforeEach(() => {
    onSendError = vi.fn()
    vi.useFakeTimers()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    answerSend = null
    mountedClient = null
    mountedAgent = 'claude'
    vi.useRealTimers()
  })

  function Harness({
    enabled,
    streamIdentity
  }: {
    enabled: boolean
    streamIdentity: string
  }): null {
    answerSend = useMobileNativeChatAnswerSend({
      client: mountedClient,
      enabled,
      handleRef: { current: 'terminal' },
      deviceTokenRef: { current: 'device' },
      agentRef: { current: mountedAgent },
      sessionId: 'session',
      streamIdentity,
      onSendError
    })
    return null
  }

  async function mount(client: RpcClient, agent: AgentType = 'claude'): Promise<void> {
    mountedClient = client
    mountedAgent = agent
    await act(async () => {
      renderer = create(createElement(Harness, { enabled: true, streamIdentity: ROUTE }))
    })
  }

  async function rerender(props: { enabled: boolean; streamIdentity: string }): Promise<void> {
    await act(async () => {
      renderer?.update(createElement(Harness, props))
    })
  }

  type HeldSends = {
    sendRequest: ReturnType<typeof vi.fn>
    settle: Array<(value: unknown) => void>
    fail: Array<(error: Error) => void>
  }

  /** A send whose reply the test settles by hand, in call order. */
  function heldSends(): HeldSends {
    const settle: Array<(value: unknown) => void> = []
    const fail: Array<(error: Error) => void> = []
    const sendRequest = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          settle.push(resolve)
          fail.push(reject)
        })
    )
    return { sendRequest, settle, fail }
  }

  /** Wrapped, not returned bare: an async function adopts a returned promise,
   *  so awaiting the tap would wait for the answer the test has yet to settle. */
  async function tapSubmit(
    prompt: AskPrompt,
    indices: number[][]
  ): Promise<{ answer: Promise<boolean> | undefined }> {
    let answer: Promise<boolean> | undefined
    await act(async () => {
      answer = answerSend?.answerAsk(
        prompt,
        indices.map((picked) => ({ indices: picked }))
      )
      await Promise.resolve()
    })
    return { answer }
  }

  async function settleSend(settle: (value: unknown) => void, accepted: boolean): Promise<void> {
    await act(async () => {
      settle(reply(accepted))
      await Promise.resolve()
    })
  }

  it('says the answer was not sent when the input lease drops under its refused option key', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    const { answer: first } = await tapSubmit(PUSH, [[0]])
    expect(sendRequest).toHaveBeenCalledTimes(1)
    // The phone loses the input floor while the digit is on the wire, and the
    // host refuses it. The card stays up with Submit re-enabled.
    await rerender({ enabled: false, streamIdentity: ROUTE })
    await settleSend(settle[0]!, false)

    await expect(first).resolves.toBe(false)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Answer not sent')
  })

  it('says the answer is unconfirmed when the lease drops under a key whose ack is lost', async () => {
    const { sendRequest, fail } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    const { answer: first } = await tapSubmit(PUSH, [[0]])
    await rerender({ enabled: false, streamIdentity: ROUTE })
    await act(async () => {
      fail[0]!(markRpcDeliveryUnknown(new Error('Connection closed')))
      await Promise.resolve()
    })

    // The digit may have landed, and Claude submits on it: a second tap would
    // type "1" into Claude's prompt (captured on 2.1.281). Say to check first.
    await expect(first).resolves.toBe(false)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Answer unconfirmed — check chat before retrying')
  })

  it('says a two-question answer is partly sent when the lease drops between its keys', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    const { answer: first } = await tapSubmit(TWO_QUESTIONS, [[1], [0]])
    await settleSend(settle[0]!, true)
    // Claude has moved to the second question; the pacing wait is cut short.
    await rerender({ enabled: false, streamIdentity: ROUTE })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    await expect(first).resolves.toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Answer partly sent — check chat before retrying')
  })

  it('says so when Stop cancels an answer whose key is then refused', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    const { answer: first } = await tapSubmit(PUSH, [[1]])
    await act(async () => {
      answerSend?.cancelPending()
      settle[0]!(reply(false))
      await Promise.resolve()
    })

    await expect(first).resolves.toBe(false)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Answer not sent')
  })

  it('says an answer queued behind another was not sent when Stop lands while it waits', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    const { answer: first } = await tapSubmit(PUSH, [[0]])
    const { answer: second } = await tapSubmit(PUSH, [[1]])
    await act(async () => {
      answerSend?.cancelPending()
    })
    // The first key is refused outright, so the queued answer may go ahead,
    // but Stop has cancelled it: it writes nothing, and must say so.
    await settleSend(settle[0]!, false)

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Answer not sent')
  })

  it('still reports an answer the chat has moved away from, for the toast to carry', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    const { answer: first } = await tapSubmit(PUSH, [[0]])
    await rerender({ enabled: true, streamIdentity: ANOTHER_TAB })
    await settleSend(settle[0]!, false)

    await expect(first).resolves.toBe(false)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Answer not sent')
  })

  // Second review (2026-09-25): gating on the route as well dropped this one,
  // which the turn slot alone had always reported.
  it('still reports a fenced answer after the chat has moved away', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    const { answer: first } = await tapSubmit(TWO_QUESTIONS, [[1], [0]])
    const { answer: second } = await tapSubmit(TWO_QUESTIONS, [[1], [0]])
    await rerender({ enabled: true, streamIdentity: ANOTHER_TAB })
    // The first answer's key lands, so the queued one is fenced.
    await settleSend(settle[0]!, true)
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Answer not sent — check chat before retrying')
  })

  it('leaves the banner to the newer answer that took over', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    const { answer: first } = await tapSubmit(PUSH, [[0]])
    const { answer: second } = await tapSubmit(PUSH, [[1]])
    await settleSend(settle[0]!, false)
    await settleSend(settle[1]!, true)

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
  })

  describe('a pasted answer (Grok)', () => {
    it('says it was not sent when Stop lands during the clear before it', async () => {
      const { sendRequest, settle } = heldSends()
      await mount({ sendRequest } as unknown as RpcClient, 'grok')
      markMobileNativeChatInputStale('terminal')

      const { answer: first } = await tapSubmit(PUSH, [[1]])
      await act(async () => {
        answerSend?.cancelPending()
      })
      await settleSend(settle[0]!, true)

      await expect(first).resolves.toBe(false)
      // Only the clear went out; the label never did.
      expect(sendRequest).toHaveBeenCalledTimes(1)
      expect(onSendError).toHaveBeenCalledTimes(1)
      expect(onSendError).toHaveBeenCalledWith('Answer not sent')
    })

    it('says it was not sent when the clear is refused after Stop', async () => {
      const { sendRequest, settle } = heldSends()
      await mount({ sendRequest } as unknown as RpcClient, 'grok')
      markMobileNativeChatInputStale('terminal')

      const { answer: first } = await tapSubmit(PUSH, [[1]])
      await act(async () => {
        answerSend?.cancelPending()
      })
      await settleSend(settle[0]!, false)

      await expect(first).resolves.toBe(false)
      expect(onSendError).toHaveBeenCalledTimes(1)
      expect(onSendError).toHaveBeenCalledWith('Answer not sent')
    })

    it('says it was not sent when Stop lands under its refused write', async () => {
      const { sendRequest, settle } = heldSends()
      await mount({ sendRequest } as unknown as RpcClient, 'grok')

      const { answer: first } = await tapSubmit(PUSH, [[1]])
      expect(sendRequest.mock.calls[0]?.[1]).toMatchObject({
        text: 'No, keep it local',
        enter: true
      })
      await act(async () => {
        answerSend?.cancelPending()
      })
      await settleSend(settle[0]!, false)

      await expect(first).resolves.toBe(false)
      expect(onSendError).toHaveBeenCalledTimes(1)
      expect(onSendError).toHaveBeenCalledWith('Answer not sent')
    })
  })
})
