import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { formatQuestionFreeTextAnswer } from './mobile-native-chat-question'
import { ANSWER_TOO_LONG, ANSWER_TOO_LONG_FOR_HOST } from './mobile-structured-question-response'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() }
}))

// A host older than Orca 1.4.217 validates `respondToQuestion` with the strict shape below (the
// RespondParams of v1.4.211: `optionId` only, no `answers`). Its RPC layer answers a schema failure
// with `invalid_argument` and zod's own text.
const OLD_RESPOND_PARAMS = z
  .object({
    envelope: z.unknown(),
    itemId: z.string().min(1, 'Invalid item id'),
    expectedRevision: z.number().int().positive(),
    optionId: z.string().min(1, 'Invalid option id').max(1024, 'Invalid option id')
  })
  .strict()

// The v1.4.217 host's own schema, loaded by a computed path (the params-contract boundary census reads
// static specifiers; a test is not bundled).
const HOST_PARAMS_MODULE = fileURLToPath(
  new URL('../../../src/shared/rpc-contract/structured-agent-session-params.ts', import.meta.url)
)
const { RespondToQuestionParams } = (await import(
  /* @vite-ignore */ HOST_PARAMS_MODULE
)) as typeof import('../../../src/shared/rpc-contract/structured-agent-session-params')
let hostSchema: { safeParse: (value: unknown) => z.ZodSafeParseResult<unknown> } =
  OLD_RESPOND_PARAMS

const LONG = `${'The migration plan needs a rollback step. '.repeat(40)}Then verify.`

function snapshotWithQuestion(): AgentSessionSubscribeEvent {
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
          observedAt: 12,
          body: {
            kind: 'question',
            question: 'Pick destination',
            freeTextQuestionId: 'free-q',
            options: [{ id: 'choice-a', label: 'Choice A' }],
            resolution: {
              state: 'pending',
              selectedOptionId: null,
              resolvedBy: null,
              resolvedAt: null
            }
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
  } as AgentSessionSubscribeEvent
}

describe('a long typed answer sent to a host older than Orca 1.4.217', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  let listener: ((value: unknown) => void) | null = null
  const onSendError = vi.fn()
  const sendRequest = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'agentSession.respondToQuestion') {
      const parsed = hostSchema.safeParse(params)
      return parsed.success
        ? {
            ok: true,
            result: {
              ok: true,
              replayed: false,
              fence: 3,
              cursor: { epoch: 'epoch-1', sequence: 2 },
              value: { itemId: 'question-1', revision: 8 }
            },
            _meta: { runtimeId: 'runtime-1' }
          }
        : {
            ok: false,
            error: { code: 'invalid_argument', message: parsed.error.issues[0]!.message }
          }
    }
    return { ok: true, result: {}, _meta: { runtimeId: 'runtime-1' } }
  })
  const client = {
    sendRequest,
    subscribe: (_m: string, _p: unknown, onData: (value: unknown) => void) => {
      listener = onData
      return vi.fn()
    }
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
    } as never)
    return null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    hostSchema = OLD_RESPOND_PARAMS
    act(() => {
      renderer = create(createElement(Harness))
    })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  it('names the cause, and keeps the card open so the answer can be shortened', async () => {
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(snapshotWithQuestion()))
    const question = hook!.question!
    expect(question).toBeTruthy()

    await act(async () => {
      expect(await hook!.respondQuestion(formatQuestionFreeTextAnswer(question, LONG))).toBe(false)
    })

    expect(onSendError).toHaveBeenCalledWith(ANSWER_TOO_LONG_FOR_HOST)
    expect(onSendError).not.toHaveBeenCalledWith(expect.stringContaining('expected string'))
    // The question is still pending, so the card is still there to answer again.
    expect(hook!.question).toBeTruthy()
  })

  it('still sends a short answer the way this host reads it', async () => {
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(snapshotWithQuestion()))

    await act(async () => {
      expect(
        await hook!.respondQuestion(formatQuestionFreeTextAnswer(hook!.question!, 'custom answer'))
      ).toBe(true)
    })
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('says to shorten it, not to update Orca, when a 1.4.217 host refuses it as too big', async () => {
    hostSchema = RespondToQuestionParams
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(snapshotWithQuestion()))
    const seventyThousand = 'a'.repeat(70_000)

    await act(async () => {
      expect(
        await hook!.respondQuestion(formatQuestionFreeTextAnswer(hook!.question!, seventyThousand))
      ).toBe(false)
    })

    expect(onSendError).toHaveBeenCalledWith(ANSWER_TOO_LONG)
    expect(onSendError).not.toHaveBeenCalledWith(ANSWER_TOO_LONG_FOR_HOST)
    expect(hook!.question).toBeTruthy()
  })

  it('still accepts a long answer that fits on a 1.4.217 host', async () => {
    hostSchema = RespondToQuestionParams
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(snapshotWithQuestion()))
    await act(async () => {
      expect(await hook!.respondQuestion(formatQuestionFreeTextAnswer(hook!.question!, LONG))).toBe(
        true
      )
    })
    expect(onSendError).not.toHaveBeenCalled()
  })
})
