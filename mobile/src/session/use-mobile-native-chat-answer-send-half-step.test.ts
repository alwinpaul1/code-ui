import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskPrompt } from '../../../src/shared/native-chat-ask'
import type { RpcClient } from '../transport/rpc-client'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import {
  markMobileNativeChatTerminalHalfStepped,
  mobileNativeChatTerminalHalfStep,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatAnswerSend } from './use-mobile-native-chat-answer-send'

type AnswerSend = ReturnType<typeof useMobileNativeChatAnswerSend>

function acceptedResponse() {
  return {
    id: 'send',
    ok: true as const,
    result: { send: { accepted: true } },
    _meta: { runtimeId: 'runtime' }
  }
}

function refusedResponse() {
  return { id: 'send', ok: true as const, result: { send: { accepted: false } }, _meta: { runtimeId: 'r' } }
}

const TABS_OR_SPACES: AskPrompt = {
  questions: [
    { question: 'Tabs or spaces?', multiSelect: false, options: [{ label: 'Tabs' }, { label: 'Spaces' }] }
  ]
}

const TWO_QUESTIONS: AskPrompt = {
  questions: [
    { question: 'q1', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
    { question: 'q2', multiSelect: false, options: [{ label: 'C' }, { label: 'D' }] }
  ]
}

/**
 * The card's own fence for a half-written answer (writeTurnsRef,
 * finishTurn(false)) lives in the hook and is invisible to the notification
 * shade — and the shade's is invisible to the hook. A reply half-written from
 * the shade, then retried from the card (or the other way round), would type
 * the row digit into the open text field or toggle a box back off (review
 * finding F4, 2026-09-18). The mark beside the terminal write lock is the one
 * both consult. Split from the hook's main suite only for that file's line cap.
 */
describe('the chat card and a terminal left half-stepped', () => {
  let renderer: ReactTestRenderer | null = null
  let answerSend: AnswerSend | null = null
  let mountedClient: RpcClient | null = null
  let mountedOnSendError: ((message: string) => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    answerSend = null
    mountedClient = null
    mountedOnSendError = null
    vi.useRealTimers()
  })

  function Harness(): null {
    answerSend = useMobileNativeChatAnswerSend({
      client: mountedClient,
      enabled: true,
      handleRef: { current: 'terminal' },
      deviceTokenRef: { current: 'device' },
      agentRef: { current: 'claude' },
      sessionId: 'session',
      streamIdentity: 'host\0worktree\0tab\0session',
      onSendError: mountedOnSendError!
    })
    return null
  }

  async function mount(client: RpcClient, onSendError: (message: string) => void): Promise<void> {
    mountedClient = client
    mountedOnSendError = onSendError
    await act(async () => {
      renderer = create(createElement(Harness))
    })
  }

  it('marks the terminal when its own multi-step answer stops after a landed key', async () => {
    const onSendError = vi.fn()
    let calls = 0
    const sendRequest = vi.fn(async () => {
      calls += 1
      return calls === 1 ? acceptedResponse() : refusedResponse()
    })
    await mount({ sendRequest } as unknown as RpcClient, onSendError)

    let result: Promise<boolean> | undefined
    await act(async () => {
      result = answerSend?.answerAsk(TWO_QUESTIONS, [{ indices: [1] }, { indices: [0] }])
    })
    await act(async () => vi.runAllTimersAsync())
    await expect(result).resolves.toBe(false)
    expect(mobileNativeChatTerminalHalfStep('terminal')).toMatchObject({
      detail: expect.stringContaining('2/3')
    })
  })

  it('does not mark a one-key answer that was refused outright', async () => {
    const sendRequest = vi.fn().mockResolvedValue(refusedResponse())
    await mount({ sendRequest } as unknown as RpcClient, vi.fn())
    await expect(answerSend?.answerAsk(TABS_OR_SPACES, [{ indices: [1] }])).resolves.toBe(false)
    expect(mobileNativeChatTerminalHalfStep('terminal')).toBeNull()
  })

  it('refuses to answer the same prompt the shade left half written, and says so', async () => {
    const onSendError = vi.fn()
    const sendRequest = vi.fn().mockResolvedValue(acceptedResponse())
    await mount({ sendRequest } as unknown as RpcClient, onSendError)
    markMobileNativeChatTerminalHalfStepped('terminal', {
      promptKey: `question:${JSON.stringify(TABS_OR_SPACES.questions)}`,
      detail: 'write 2/3 rejected'
    })

    await expect(answerSend?.answerAsk(TABS_OR_SPACES, [{ indices: [1] }])).resolves.toBe(false)
    expect(sendRequest).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith(
      'Answer partly sent earlier — finish it in the terminal before retrying'
    )
  })

  it('answers a different prompt on that terminal, and forgets the mark', async () => {
    const sendRequest = vi.fn().mockResolvedValue(acceptedResponse())
    await mount({ sendRequest } as unknown as RpcClient, vi.fn())
    markMobileNativeChatTerminalHalfStepped('terminal', {
      promptKey: 'question:[something else]',
      detail: 'write 2/3 rejected'
    })

    await expect(answerSend?.answerAsk(TABS_OR_SPACES, [{ indices: [1] }])).resolves.toBe(true)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(mobileNativeChatTerminalHalfStep('terminal')).toBeNull()
  })
})
