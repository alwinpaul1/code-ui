import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentSessionSendResult,
  AgentSessionSubscribeEvent
} from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { formatQuestionFreeTextAnswer } from './mobile-native-chat-question'
import {
  failureMessage,
  requestStructuredAgentSessionMutation
} from './mobile-structured-agent-session-rpc'
import { ANSWER_TOO_LONG, explainLongAnswerFailure } from './mobile-structured-question-response'
import { mobileStructuredSendDelivery } from './mobile-structured-send-delivery'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() }
}))

// Found by the review of the #23674 port (54f73304f). A 1.4.219+ host throws an agent-session
// refusal as an RPC error: its code is the refusal's code where the host passes it through
// (`RUNTIME_PASSTHROUGH_CODES`: identity_required, ownership_unknown, execution_owner_reconciling),
// else `runtime_error`; its message is the bare code; the refusal rides in `error.data`
// (`agentSessionRefusalErrorResponse`, src/main/runtime/rpc/errors.ts at v1.4.220). A thrown
// refusal is the same refusal as a returned one, so the phone must treat it the same way.
const PASSTHROUGH = new Set([
  'agent_session_identity_required',
  'agent_session_ownership_unknown',
  'execution_owner_reconciling'
])

function thrownRefusal(code: string) {
  return {
    id: 'req',
    ok: false,
    error: {
      code: PASSTHROUGH.has(code) ? code : 'runtime_error',
      message: code,
      data: { refusal: { code } }
    }
  }
}

function returnedRefusal(code: string) {
  return { id: 'req', ok: true, result: { ok: false, refusal: { code, message: code } } }
}

function clientAnswering(response: unknown): RpcClient {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the path under test reaches only `sendRequest`.
  return { sendRequest: async () => response } as unknown as RpcClient
}

describe('a send the host refused by throwing', () => {
  // The returned form of each is refused before admission (agent-session-refusal-retry.ts), so the
  // phone keeps the operation id; spending it on the thrown form would turn the same refusal into
  // a new message on the next send.
  it.each([
    'agent_session_ownership_unknown',
    'agent_session_journal_unreadable',
    'execution_owner_reconciling',
    'agent_session_identity_required'
  ])('keeps the operation id for a thrown %s, as for the returned one', async (code) => {
    const request = (response: unknown) =>
      requestStructuredAgentSessionMutation<AgentSessionSendResult>({
        client: clientAnswering(response),
        method: 'agentSession.send',
        fingerprintMethod: 'agentSession.send',
        sessionId: 'session-1',
        expectedRuntimeFence: 3,
        fields: { body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'hello' }] } },
        clientOperationId: `1900000000000-${'a'.repeat(32)}`
      })
    const thrown = mobileStructuredSendDelivery(await request(thrownRefusal(code)))
    const returned = mobileStructuredSendDelivery(await request(returnedRefusal(code)))
    expect(returned.operationIdSpent).toBe(false)
    expect(thrown).toEqual(returned)
  })
})

describe("an answer too long for the host's schema", () => {
  it('still says it is too long when the host refuses it at the schema', async () => {
    const result = await requestStructuredAgentSessionMutation({
      client: clientAnswering({
        id: 'req',
        ok: false,
        error: {
          code: 'invalid_argument',
          message: 'Too big: expected string to have <=65536 characters'
        }
      }),
      method: 'agentSession.respondToQuestion',
      fingerprintMethod: 'agentSession.respondTo:question',
      sessionId: 'session-1',
      expectedRuntimeFence: 3,
      fields: { itemId: 'q', expectedRevision: 1, answers: [] }
    })
    if (result.status !== 'failed' && result.status !== 'refused') {
      throw new Error(`unexpected ${result.status}`)
    }
    expect(failureMessage(result, { explainFailure: explainLongAnswerFailure })).toBe(
      ANSWER_TOO_LONG
    )
  })
})

const LONG = `${'The migration plan needs a rollback step. '.repeat(40)}Then verify.`

function questionSnapshot(): AgentSessionSubscribeEvent {
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
          itemId: 'question-1',
          revision: 7,
          sequence: 1,
          observedAt: 10,
          body: {
            kind: 'question',
            question: 'Pick destination',
            freeTextQuestionId: 'free-q',
            options: [
              { id: 'choice-a', label: 'Choice A' },
              { id: 'choice-b', label: 'Choice B' }
            ],
            resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
          }
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

describe('a typed answer the host refuses by throwing', () => {
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

  async function answerWith(answer: string): Promise<string | undefined> {
    act(() => renderer?.unmount())
    listener = null
    sendRequest.mockImplementation(accepted)
    act(() => {
      renderer = create(createElement(Harness))
    })
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(questionSnapshot()))
    await vi.waitFor(() => expect(hook?.question).toBeTruthy())
    sendRequest.mockImplementation(async (method: string) =>
      method === 'agentSession.respondToQuestion'
        ? thrownRefusal('agent_session_journal_unreadable')
        : accepted(method)
    )
    onSendError.mockClear()
    await act(async () => {
      await hook!.respondQuestion(formatQuestionFreeTextAnswer(hook!.question!, answer))
    })
    return onSendError.mock.calls.at(-1)?.[0] as string | undefined
  }

  it('words a long answer as it words a short one, never the bare code', async () => {
    const short = await answerWith('custom answer')
    // Over 1 KiB, so it goes out as `answers`, the call the long-answer explainer words.
    const long = await answerWith(LONG)
    expect(short).toBe("Orca couldn't read this chat's saved history. Your answer was not sent.")
    expect(long).toBe(short)
  })
})
