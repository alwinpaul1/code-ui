import { describe, expect, it } from 'vitest'
import { parseAskFromStatus, type AskPrompt } from '../../../src/shared/native-chat-ask'
import {
  ASK_USER_QUESTION_CLEANUP,
  ASK_USER_QUESTION_CONTEXT_RING,
  ASK_USER_QUESTION_STACK_AND_LOOK,
  CODEX_REQUEST_USER_INPUT
} from './ask-user-question-fixtures'
import { parseQuestionReply } from './question-reply-parse'

function ask(input: unknown): AskPrompt {
  const parsed = parseAskFromStatus(JSON.stringify(input))
  if (!parsed) {
    throw new Error('fixture did not parse')
  }
  return parsed
}

const FOUR_SINGLE = ask({
  questions: [{ ...ASK_USER_QUESTION_CLEANUP.questions[0]!, multiSelect: false }]
})
const FOUR_MULTI = ask(ASK_USER_QUESTION_CLEANUP)
const TWO_QUESTIONS = ask(ASK_USER_QUESTION_STACK_AND_LOOK)

/**
 * What a reply typed into the shade means. A digit is the option with that
 * number, exactly as the agent's own selector numbers them; anything else is
 * the free-text "Other" answer. Where the text could mean two things, or
 * names an option that is not there, nothing is written: a wrong digit
 * picks something the user never chose.
 */
describe('reading a reply typed into the shade', () => {
  describe('one question, a number', () => {
    it('picks the option with that number', () => {
      expect(parseQuestionReply(FOUR_SINGLE, '2', 'answer')).toEqual({
        ok: true,
        selections: [{ indices: [1] }]
      })
    })

    it('picks several for a multi-select, in the order typed', () => {
      expect(parseQuestionReply(FOUR_MULTI, '1,3', 'answer')).toEqual({
        ok: true,
        selections: [{ indices: [0, 2] }]
      })
    })

    it('allows spaces around the commas', () => {
      expect(parseQuestionReply(FOUR_MULTI, ' 1 , 3 ', 'answer')).toEqual({
        ok: true,
        selections: [{ indices: [0, 2] }]
      })
    })

    // Each digit TOGGLES a checkbox in a multi-select, so "1,1" written as two
    // keystrokes would select and then deselect. Once is what was meant.
    it('counts a repeated number once', () => {
      expect(parseQuestionReply(FOUR_MULTI, '1,1,3', 'answer')).toEqual({
        ok: true,
        selections: [{ indices: [0, 2] }]
      })
    })

    it('refuses a number past the last option, naming the range', () => {
      const out = parseQuestionReply(FOUR_SINGLE, '5', 'answer')
      expect(out.ok).toBe(false)
      expect(!out.ok && out.reason).toMatch(/5.*1.*4|1.*4.*5/)
    })

    it('refuses zero', () => {
      expect(parseQuestionReply(FOUR_SINGLE, '0', 'answer').ok).toBe(false)
    })

    it('refuses two numbers for a single-choice question', () => {
      const out = parseQuestionReply(FOUR_SINGLE, '1,2', 'answer')
      expect(out.ok).toBe(false)
      expect(!out.ok && out.reason).toMatch(/one/i)
    })

    // Degenerate: the one option there is.
    it('picks the only option of a one-option question', () => {
      expect(parseQuestionReply(ask(CODEX_REQUEST_USER_INPUT), '1', 'answer')).toEqual({
        ok: true,
        selections: [{ indices: [0] }]
      })
    })

    it('refuses a number for a question with no options', () => {
      const none = ask({ questions: [{ question: 'Name?', multiSelect: false, options: [] }] })
      expect(parseQuestionReply(none, '1', 'answer').ok).toBe(false)
    })
  })

  describe('one question, words', () => {
    // The card draws an "Other…" row under every question, for every agent,
    // and sends it as an empty pick with `other` text. Same here.
    it('is the free-text answer', () => {
      expect(parseQuestionReply(FOUR_SINGLE, 'none of these, keep everything', 'answer')).toEqual({
        ok: true,
        selections: [{ indices: [], other: 'none of these, keep everything' }]
      })
    })

    it('keeps a number typed into the Other field as text, not a pick', () => {
      expect(parseQuestionReply(ask(ASK_USER_QUESTION_CONTEXT_RING), '2', 'other')).toEqual({
        ok: true,
        selections: [{ indices: [], other: '2' }]
      })
    })

    it('trims the text', () => {
      expect(parseQuestionReply(FOUR_SINGLE, '  keep it  ', 'answer')).toEqual({
        ok: true,
        selections: [{ indices: [], other: 'keep it' }]
      })
    })

    // A mixed answer ("2 and also…") reads as words: the digit is not pulled
    // out of it, because a sentence that starts with a number is still a sentence.
    it('reads a sentence that starts with a number as text', () => {
      expect(parseQuestionReply(FOUR_SINGLE, '2 but only the caches', 'answer')).toEqual({
        ok: true,
        selections: [{ indices: [], other: '2 but only the caches' }]
      })
    })

    it.each([
      ['empty', ''],
      ['only spaces', '   '],
      ['only a comma', ','],
      ['only a semicolon', ';']
    ])('refuses an answer that is %s', (_label, text) => {
      expect(parseQuestionReply(FOUR_SINGLE, text, 'answer').ok).toBe(false)
      expect(parseQuestionReply(FOUR_SINGLE, text, 'other').ok).toBe(false)
    })

    /**
     * Digits spelt some other way — "1 3", "2.", "2)", "#2", "1;3" on a one-
     * question prompt — are numbers the user meant as picks, not words. Typed
     * as an Other answer they would reach the agent as the string "1 3"
     * (review finding F5, 2026-09-18). With no letter in them there is no
     * sentence to keep, so they are refused, and the reason says the spelling.
     */
    it.each(['1 3', '2.', '2)', '#2', '1;3', '1,,2', '1, 3.'])(
      'refuses the numbers-only spelling %j rather than typing it as text',
      (text) => {
        const out = parseQuestionReply(FOUR_MULTI, text, 'answer')
        expect(out.ok).toBe(false)
        expect(!out.ok && out.reason).toMatch(/1,3/)
      }
    )

    it('still types a numbers-only spelling into the Other field as text', () => {
      expect(parseQuestionReply(FOUR_MULTI, '1 3', 'other')).toEqual({
        ok: true,
        selections: [{ indices: [], other: '1 3' }]
      })
    })
  })

  describe('several questions', () => {
    it('takes one answer per question, separated by semicolons, in order', () => {
      expect(parseQuestionReply(TWO_QUESTIONS, '2; free text here', 'answer')).toEqual({
        ok: true,
        selections: [{ indices: [1] }, { indices: [], other: 'free text here' }]
      })
    })

    it('reads numbers per question against that question’s options', () => {
      // Question 2 has three options; "3" is in range there.
      expect(parseQuestionReply(TWO_QUESTIONS, '1;3', 'answer')).toEqual({
        ok: true,
        selections: [{ indices: [0] }, { indices: [2] }]
      })
    })

    it('refuses fewer answers than questions, saying how many it wanted', () => {
      const out = parseQuestionReply(TWO_QUESTIONS, '2', 'answer')
      expect(out.ok).toBe(false)
      expect(!out.ok && out.reason).toMatch(/1.*2|2.*1/)
    })

    // More parts than questions is a semicolon inside a free-text answer, and
    // there is no way to tell which one. Refuse rather than guess the split.
    it('refuses more answers than questions', () => {
      expect(parseQuestionReply(TWO_QUESTIONS, '2; a; b', 'answer').ok).toBe(false)
    })

    it('refuses when one of the answers is empty', () => {
      expect(parseQuestionReply(TWO_QUESTIONS, '2;', 'answer').ok).toBe(false)
      expect(parseQuestionReply(TWO_QUESTIONS, ';2', 'answer').ok).toBe(false)
    })

    it('refuses a number out of range in the second question, naming it', () => {
      const out = parseQuestionReply(TWO_QUESTIONS, '1; 4', 'answer')
      expect(out.ok).toBe(false)
      expect(!out.ok && out.reason).toMatch(/question 2/i)
    })

    // A single question never splits: a semicolon in its text is just text.
    it('keeps a semicolon inside a one-question answer', () => {
      expect(parseQuestionReply(FOUR_SINGLE, 'a; b', 'answer')).toEqual({
        ok: true,
        selections: [{ indices: [], other: 'a; b' }]
      })
    })
  })
})
