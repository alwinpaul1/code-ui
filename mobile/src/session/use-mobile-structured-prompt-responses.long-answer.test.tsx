import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalQuestion,
  AgentJournalRenderItem
} from '../../../src/shared/agent-session-journal-types'
import type * as HostParams from '../../../src/shared/rpc-contract/structured-agent-session-params'
import type { StructuredAgentSessionState } from '../../../src/shared/structured-agent-session-reducer'
import { formatQuestionFreeTextAnswer } from './mobile-native-chat-question'
import {
  projectStructuredQuestion,
  type StructuredQuestionItem
} from './mobile-structured-agent-prompts'
import { projectGroupedQuestion } from './mobile-structured-grouped-question'
import { RESPOND_TO_QUESTION_OPTION_ID_MAX_LENGTH } from './mobile-structured-question-response'
import { useMobileStructuredPromptResponses } from './use-mobile-structured-prompt-responses'

// Orca v1.4.217 (#22793): a typed "Other" answer was packed into `optionId`, a field the host caps
// at 1024 characters, so a long answer failed with "Invalid option id" and never reached the agent.
// The host now also takes per-question `answers`, and validates every call with
// `RespondToQuestionParams`, which is what these tests hold the phone's requests to. Verified
// against the schema vendored at v1.4.217 (Orca 1.4.217); a live 1.4.217 host was not run.

// The host's own schema, loaded by a computed path on purpose. rpc-params-contract-type-only-boundary
// keeps the contract's zod schemas out of everything the app bundles by reading static import
// specifiers; a test is not bundled and needs the host's real verdict, not a restatement of it.
const HOST_PARAMS_MODULE = fileURLToPath(
  new URL('../../../src/shared/rpc-contract/structured-agent-session-params.ts', import.meta.url)
)
const { MAX_RESPONSE_OPTION_ID_LENGTH, RespondToQuestionParams } = (await import(
  /* @vite-ignore */ HOST_PARAMS_MODULE
)) as typeof HostParams

const ENVELOPE = {
  sessionId: 'session-1',
  clientOperationId: 'op-1',
  expectedRuntimeFence: 3,
  payloadFingerprint: 'a'.repeat(64)
}

function pending(body: StructuredQuestionItem['body']): StructuredQuestionItem {
  return { itemId: 'question-1', revision: 7, sequence: 2, observedAt: 12, body }
}

// The shape the Codex adapter journals: one question with its own free-text id.
function codexQuestion(): StructuredQuestionItem {
  return pending({
    kind: 'question',
    question: 'Pick destination',
    freeTextQuestionId: 'free-q',
    options: [
      { id: 'choice-a', label: 'Choice A' },
      { id: 'choice-b', label: 'Choice B' }
    ],
    resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
  })
}

const CLAUDE_QUESTIONS: AgentJournalQuestion[] = [
  {
    id: 'q1',
    question: 'Which database?',
    multiSelect: false,
    options: [
      { id: 'q1:choice-1', label: 'Postgres' },
      { id: 'q1:choice-2', label: 'SQLite' }
    ],
    freeTextQuestionId: 'q1'
  },
  {
    id: 'q2',
    question: 'Which regions?',
    multiSelect: true,
    options: [
      { id: 'q2:choice-1', label: 'us-east' },
      { id: 'q2:choice-2', label: 'eu-west' }
    ],
    freeTextQuestionId: 'q2'
  }
]

// The shape the Claude adapter journals for a grouped AskUserQuestion.
function claudeGroupedQuestion(): StructuredQuestionItem {
  return pending({
    kind: 'question',
    question: 'Which database?',
    options: [],
    questions: CLAUDE_QUESTIONS,
    resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
  })
}

function stateWith(item: AgentJournalRenderItem): StructuredAgentSessionState {
  return {
    epoch: 'epoch-1',
    cursor: { epoch: 'epoch-1', sequence: 2 },
    fence: 3,
    items: [item],
    submissions: [],
    retainedItemLimit: 1024,
    hasOlder: false,
    status: 'ready'
  }
}

type Responses = ReturnType<typeof useMobileStructuredPromptResponses>

function mount(item: AgentJournalRenderItem): {
  responses: () => Responses
  fields: () => Record<string, unknown>[]
} {
  const sent: Record<string, unknown>[] = []
  const mutate = vi.fn(async (_method: string, _key: string, fields: Record<string, unknown>) => {
    sent.push(fields)
    return { status: 'accepted', value: {}, sameFence: true }
  }) as never
  let latest: Responses | null = null
  function Harness(): null {
    latest = useMobileStructuredPromptResponses({
      stateRef: { current: stateWith(item) },
      sessionKey: 'session-1',
      mutate,
      onSendError: vi.fn()
    })
    return null
  }
  act(() => {
    create(createElement(Harness))
  })
  return { responses: () => latest!, fields: () => sent }
}

/** What the host's own schema says about a request the phone sent. */
function hostVerdict(fields: Record<string, unknown>): { ok: boolean; message: string } {
  const parsed = RespondToQuestionParams.safeParse({ envelope: ENVELOPE, ...fields })
  return { ok: parsed.success, message: parsed.success ? '' : parsed.error.issues[0]!.message }
}

const LONG = `${'The migration plan needs a rollback step. '.repeat(40)}Then verify.`

describe('answering a structured question with a long typed answer', () => {
  it("repeats the host's option id limit", () => {
    expect(RESPOND_TO_QUESTION_OPTION_ID_MAX_LENGTH).toBe(MAX_RESPONSE_OPTION_ID_LENGTH)
  })

  it('sends a Codex free-text answer the host accepts when it is longer than an option id can hold', async () => {
    const { responses, fields } = mount(codexQuestion())
    const question = projectStructuredQuestion(codexQuestion())!
    expect(LONG.length).toBeGreaterThan(1500)

    await act(async () => {
      expect(await responses().respondQuestion(formatQuestionFreeTextAnswer(question, LONG))).toBe(
        true
      )
    })

    expect(hostVerdict(fields()[0]!)).toEqual({ ok: true, message: '' })
    expect(fields()[0]).toMatchObject({
      itemId: 'question-1',
      expectedRevision: 7,
      answers: [{ questionId: 'free-q', optionIds: [], other: LONG.trim() }]
    })
    expect(fields()[0]).not.toHaveProperty('optionId')
  })

  it('sends a grouped Claude answer the host accepts when the group does not fit in an option id', async () => {
    const { responses, fields } = mount(claudeGroupedQuestion())
    const first = projectGroupedQuestion(CLAUDE_QUESTIONS, null, `question-1:7`, {
      itemId: 'question-1',
      expectedRevision: 7
    })!
    await act(async () => {
      await responses().respondQuestion(first.optionTokens[0]!)
    })
    const second = projectStructuredQuestion(claudeGroupedQuestion(), responses().groupedDraft)!
    await act(async () => {
      expect(await responses().respondQuestion(formatQuestionFreeTextAnswer(second, LONG))).toBe(
        true
      )
    })

    const body = fields()[0]!
    expect(hostVerdict(body)).toEqual({ ok: true, message: '' })
    expect(body).toMatchObject({
      answers: [
        { questionId: 'q1', optionIds: ['q1:choice-1'] },
        { questionId: 'q2', optionIds: [], other: LONG.trim() }
      ]
    })
  })

  it('keeps the packed option id for a short answer, the one form every host reads', async () => {
    const { responses, fields } = mount(codexQuestion())
    const question = projectStructuredQuestion(codexQuestion())!

    await act(async () => {
      await responses().respondQuestion(formatQuestionFreeTextAnswer(question, 'custom answer'))
    })

    expect(hostVerdict(fields()[0]!).ok).toBe(true)
    expect(fields()[0]).toEqual({
      itemId: 'question-1',
      expectedRevision: 7,
      optionId: `${encodeURIComponent('free-q')}:${encodeURIComponent('custom answer')}`
    })
  })

  it.each([
    ['exactly at the option id limit', 1024, 'optionId'],
    ['one past it', 1025, 'answers']
  ])('switches form %s', async (_name, packedLength, expectedField) => {
    const { responses, fields } = mount(codexQuestion())
    const question = projectStructuredQuestion(codexQuestion())!
    const overhead = `${encodeURIComponent('free-q')}:`.length
    const answer = 'a'.repeat(packedLength - overhead)

    await act(async () => {
      await responses().respondQuestion(formatQuestionFreeTextAnswer(question, answer))
    })

    expect(Object.keys(fields()[0]!)).toContain(expectedField)
    expect(hostVerdict(fields()[0]!).ok).toBe(true)
  })
})
