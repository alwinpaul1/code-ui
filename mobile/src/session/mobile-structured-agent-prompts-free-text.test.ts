import { describe, expect, it } from 'vitest'
import type { AgentJournalFreeTextInput } from '../../../src/shared/agent-session-journal-types'
import { formatQuestionFreeTextAnswer, type MobileChatQuestion } from './mobile-native-chat-question'
import {
  projectStructuredQuestion,
  structuredQuestionResponseTarget,
  type StructuredQuestionItem
} from './mobile-structured-agent-prompts'

function prompt(freeTextInput?: AgentJournalFreeTextInput): StructuredQuestionItem {
  return {
    itemId: 'item-1',
    revision: 3,
    sequence: 1,
    observedAt: 1,
    body: {
      kind: 'question',
      question: 'Edit the draft',
      options: [],
      freeTextQuestionId: 'q1',
      ...(freeTextInput ? { freeTextInput } : {}),
      resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
    }
  }
}

describe('mobile structured free-text questions', () => {
  it('projects editor input metadata onto the existing question card', () => {
    const freeTextInput = {
      allowEmpty: true,
      multiline: true,
      initialValue: 'draft',
      placeholder: 'Edit here'
    }
    expect(projectStructuredQuestion(prompt(freeTextInput))?.freeTextInput).toEqual(freeTextInput)
    expect(projectStructuredQuestion(prompt())?.freeTextInput).toBeUndefined()
  })

  it('accepts empty and whitespace text only for the matching allowed prompt', () => {
    const current = prompt({ allowEmpty: true })
    const projected = projectStructuredQuestion(current)!
    for (const answer of ['', '  \n ']) {
      const response = formatQuestionFreeTextAnswer(projected, answer)
      // This fork's target carries `answers` beside the legacy packed `optionId` (upstream: `answer`).
      expect(structuredQuestionResponseTarget(response, current)).toMatchObject({
        itemId: 'item-1',
        expectedRevision: 3,
        answers: [{ questionId: 'q1', optionIds: [], other: answer }]
      })
      expect(structuredQuestionResponseTarget(response, prompt())).toBeNull()
    }
    expect(
      structuredQuestionResponseTarget(formatQuestionFreeTextAnswer(projected, ''), {
        ...current,
        revision: 4
      })
    ).toBeNull()
  })

  it('keeps legacy trimming for ordinary free-text answers', () => {
    const current = prompt()
    const projected = projectStructuredQuestion(current)!
    expect(
      structuredQuestionResponseTarget(
        formatQuestionFreeTextAnswer(projected, '  draft  '),
        current
      )
    ).toMatchObject({ answers: [{ other: 'draft' }] })
    expect(structuredQuestionResponseTarget('', current)).toBeNull()
  })

  // Moved from mobile-native-chat-question.test.ts (its line cap); upstream #25851 added it there.
  it('encodes empty and whitespace answers only when allowed', () => {
    const withInput: MobileChatQuestion = {
      question: 'Pick one',
      options: ['A', 'B'],
      multiSelect: false,
      optionTokens: ['1', '2'],
      freeTextToken: 'target',
      freeTextInput: { allowEmpty: true }
    }
    expect(formatQuestionFreeTextAnswer(withInput, '')).toBe('target:')
    expect(formatQuestionFreeTextAnswer(withInput, '  \n ')).toBe(`target:${encodeURIComponent('  \n ')}`)
    expect(formatQuestionFreeTextAnswer({ ...withInput, freeTextInput: undefined }, '  \n ')).toBe('')
  })
})
