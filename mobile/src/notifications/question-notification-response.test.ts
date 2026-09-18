import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseAskFromStatus,
  type AskAnswerSelection,
  type AskPrompt
} from '../../../src/shared/native-chat-ask'
import type { RpcClient } from '../transport/rpc-client'
import {
  ASK_USER_QUESTION_CLEANUP,
  ASK_USER_QUESTION_CONTEXT_RING,
  ASK_USER_QUESTION_STACK_AND_LOOK,
  ASK_USER_QUESTION_WHICH_LOGO,
  CODEX_REQUEST_USER_INPUT
} from './ask-user-question-fixtures'
import type { PendingPrompt } from './permission-lookup'
import { answerQuestionFromNotification } from './question-notification-response'

function ask(input: unknown): AskPrompt {
  const parsed = parseAskFromStatus(JSON.stringify(input))
  if (!parsed) {
    throw new Error('fixture did not parse')
  }
  return parsed
}

const CONTEXT_RING: PendingPrompt = {
  kind: 'question',
  terminal: 'agent-1',
  agent: 'claude',
  prompt: ask(ASK_USER_QUESTION_CONTEXT_RING)
}

// The key the banner stored, computed the same way the code does: the whole
// canonical prompt.
const CONTEXT_RING_KEY = `question:${JSON.stringify(CONTEXT_RING.prompt.questions)}`

const DATA = {
  hostId: 'host-1',
  worktreeId: 'wt-1',
  questionKey: CONTEXT_RING_KEY,
  picks: { 'question:0': 0, 'question:1': 1 }
}

let state = 'connected'
const client = { getState: () => state } as unknown as RpcClient
const sent: {
  terminal: string
  agent: string
  selections: AskAnswerSelection[]
  prompt: AskPrompt
}[] = []
const lookups = vi.fn(async (): Promise<PendingPrompt | null> => CONTEXT_RING)

function run(overrides: Partial<Parameters<typeof answerQuestionFromNotification>[0]> = {}) {
  return answerQuestionFromNotification({
    actionIdentifier: 'question:1',
    userText: null,
    data: DATA,
    resolveClient: () => client,
    lookup: lookups,
    send: async ({ terminal, agent, selections, prompt }) => {
      sent.push({ terminal, agent, selections, prompt })
      return true
    },
    ...overrides
  })
}

/**
 * A notification sits in the shade until it is dismissed. By the time a thumb
 * reaches a choice, the agent may have been answered at the desk, timed out,
 * or gone on to ask something else with different choices in the same slots.
 * Sending a stored digit blind would pick whatever is in that slot NOW.
 *
 * So, as for a permission, the prompt is looked up again and compared to the
 * one the banner was built from, and a mismatch sends nothing.
 */
describe('answering a question from the shade', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    sent.length = 0
    state = 'connected'
    lookups.mockReset()
    lookups.mockResolvedValue(CONTEXT_RING)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('picks the option the button stands for, on the terminal that is waiting', async () => {
    expect(await run()).toBe('sent')
    expect(sent).toEqual([
      {
        terminal: 'agent-1',
        agent: 'claude',
        selections: [{ indices: [1] }],
        prompt: CONTEXT_RING.prompt
      }
    ])
  })

  it('hands the sender the prompt that is pending NOW, not the one the banner remembered', async () => {
    // Same question, same choices, so the key matches — but the object the
    // keystrokes are built from must be the live one.
    const live: PendingPrompt = { ...CONTEXT_RING, prompt: ask(ASK_USER_QUESTION_CONTEXT_RING) }
    lookups.mockResolvedValue(live)
    await run()
    expect(sent[0]!.prompt).toBe(live.prompt)
  })

  it('names Codex when Codex is the one asking, so its keystrokes are used', async () => {
    const codex: PendingPrompt = {
      kind: 'question',
      terminal: 'codex-1',
      agent: 'codex',
      prompt: ask(CODEX_REQUEST_USER_INPUT)
    }
    lookups.mockResolvedValue(codex)
    const outcome = await run({
      actionIdentifier: 'question:0',
      data: {
        ...DATA,
        questionKey: `question:${JSON.stringify(codex.prompt.questions)}`,
        picks: { 'question:0': 0 }
      }
    })
    expect(outcome).toBe('sent')
    expect(sent).toEqual([
      { terminal: 'codex-1', agent: 'codex', selections: [{ indices: [0] }], prompt: codex.prompt }
    ])
  })

  /**
   * A reply typed into the shade. "user can reply directly from the
   * notification dont open the app" (2026-09-18). The text is read against
   * the prompt that is pending NOW, after the same stale check a button gets,
   * and what it means is the parser's call (question-reply-parse.ts).
   */
  describe('a typed reply', () => {
    const FOUR: PendingPrompt = {
      ...CONTEXT_RING,
      prompt: ask({ questions: [{ ...ASK_USER_QUESTION_CLEANUP.questions[0]!, multiSelect: false }] })
    }
    const FOUR_DATA = {
      ...DATA,
      questionKey: `question:${JSON.stringify(FOUR.prompt.questions)}`,
      picks: {}
    }

    it('sends an Other reply as the free-text answer, built the way the card builds one', async () => {
      const outcome = await run({ actionIdentifier: 'question:other', userText: 'keep everything' })
      expect(outcome).toBe('sent')
      expect(sent[0]!.selections).toEqual([{ indices: [], other: 'keep everything' }])
      expect(sent[0]!.prompt).toBe(CONTEXT_RING.prompt)
    })

    it('sends a number typed into Answer as that option', async () => {
      lookups.mockResolvedValue(FOUR)
      const outcome = await run({
        actionIdentifier: 'question:answer',
        userText: '2',
        data: FOUR_DATA
      })
      expect(outcome).toBe('sent')
      expect(sent[0]!.selections).toEqual([{ indices: [1] }])
    })

    it('sends one answer per question for a multi-question prompt', async () => {
      const two: PendingPrompt = { ...CONTEXT_RING, prompt: ask(ASK_USER_QUESTION_STACK_AND_LOOK) }
      lookups.mockResolvedValue(two)
      const outcome = await run({
        actionIdentifier: 'question:answer',
        userText: '2; something else',
        data: { ...DATA, questionKey: `question:${JSON.stringify(two.prompt.questions)}`, picks: {} }
      })
      expect(outcome).toBe('sent')
      expect(sent[0]!.selections).toEqual([{ indices: [1] }, { indices: [], other: 'something else' }])
    })

    // Refusals write nothing and say why, with the host and terminal, because
    // the shade shows the user nothing and the banner simply stays up.
    it('refuses a number past the options, and says so', async () => {
      lookups.mockResolvedValue(FOUR)
      const outcome = await run({
        actionIdentifier: 'question:answer',
        userText: '7',
        data: FOUR_DATA
      })
      expect(outcome).toBe('refused')
      expect(sent).toEqual([])
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[question-notification]'),
        expect.objectContaining({
          hostId: 'host-1',
          terminal: 'agent-1',
          reason: expect.stringContaining('7')
        })
      )
    })

    it('refuses fewer answers than questions', async () => {
      const two: PendingPrompt = { ...CONTEXT_RING, prompt: ask(ASK_USER_QUESTION_STACK_AND_LOOK) }
      lookups.mockResolvedValue(two)
      const outcome = await run({
        actionIdentifier: 'question:answer',
        userText: '2',
        data: { ...DATA, questionKey: `question:${JSON.stringify(two.prompt.questions)}`, picks: {} }
      })
      expect(outcome).toBe('refused')
      expect(sent).toEqual([])
    })

    it.each([
      ['no text at all', null],
      ['empty text', ''],
      ['only spaces', '   ']
    ])('refuses a reply with %s', async (_label, userText) => {
      expect(await run({ actionIdentifier: 'question:other', userText })).toBe('refused')
      expect(sent).toEqual([])
      expect(warn).toHaveBeenCalled()
    })

    // The stale check comes BEFORE the text is read: a reply written against a
    // question that has changed would answer the new one with the old words.
    it('sends nothing when the question changed before the reply arrived', async () => {
      lookups.mockResolvedValue({ ...CONTEXT_RING, prompt: ask(ASK_USER_QUESTION_WHICH_LOGO) })
      expect(await run({ actionIdentifier: 'question:other', userText: 'keep everything' })).toBe(
        'stale'
      )
      expect(sent).toEqual([])
    })

    it('sends nothing when nothing is waiting any more', async () => {
      lookups.mockResolvedValue(null)
      expect(await run({ actionIdentifier: 'question:answer', userText: '2' })).toBe('stale')
      expect(sent).toEqual([])
    })

    // A reply field on a banner is ours only when the banner is: a stranger's
    // data with our identifier is not an answer.
    it('is not an answer when the data is not a question banner', async () => {
      expect(
        await run({ actionIdentifier: 'question:other', userText: 'x', data: { hello: 'world' } })
      ).toBe('not-an-answer')
    })
  })

  it('sends nothing when the agent has moved on to a different question', async () => {
    lookups.mockResolvedValue({ ...CONTEXT_RING, prompt: ask(ASK_USER_QUESTION_WHICH_LOGO) })
    expect(await run()).toBe('stale')
    expect(sent).toEqual([])
  })

  /**
   * The subtle one: the same question re-asked with different choices. The
   * text matches; the digit in slot 2 now means something else.
   */
  it('sends nothing when the question is the same but the choices are not', async () => {
    const reshuffled = ask({
      questions: [
        {
          ...ASK_USER_QUESTION_CONTEXT_RING.questions[0]!,
          options: [{ label: 'Skip it for Codex' }, { label: 'Tap to refresh' }]
        }
      ]
    })
    lookups.mockResolvedValue({ ...CONTEXT_RING, prompt: reshuffled })
    expect(await run()).toBe('stale')
    expect(sent).toEqual([])
  })

  it('sends nothing when nothing is waiting any more', async () => {
    lookups.mockResolvedValue(null)
    expect(await run()).toBe('stale')
    expect(sent).toEqual([])
  })

  // A permission arriving where the question was: a digit into an approval
  // prompt would approve something.
  it('sends nothing when what is waiting is a permission instead', async () => {
    lookups.mockResolvedValue({
      kind: 'permission',
      terminal: 'agent-1',
      agent: 'claude',
      permission: { title: 'Allow Bash?', options: [{ label: 'Allow', send: '1' }] }
    })
    expect(await run()).toBe('stale')
    expect(sent).toEqual([])
  })

  // Degenerate: a pick past the options the live prompt has. The key check
  // makes this unreachable through our own banners; a hand-made payload is
  // still refused rather than turned into a digit, and the refusal is logged.
  it('sends nothing for a pick the live question does not have', async () => {
    expect(
      await run({ actionIdentifier: 'question:5', data: { ...DATA, picks: { 'question:5': 5 } } })
    ).toBe('refused')
    expect(sent).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[question-notification]'),
      expect.objectContaining({ terminal: 'agent-1', reason: expect.stringContaining('5') })
    )
  })

  // Android delivers its DEFAULT identifier when the body is tapped rather than
  // a button. That means "open the app", and must never answer anything.
  it.each([
    ['the body was tapped', 'expo.modules.notifications.actions.DEFAULT'],
    ['an identifier we did not set', 'question:9'],
    ['a permission button somehow', 'permission:0']
  ])('sends nothing when %s', async (_label, actionIdentifier) => {
    expect(await run({ actionIdentifier })).toBe('not-an-answer')
    expect(sent).toEqual([])
  })

  it.each([
    ['there is no data', undefined],
    ['the data is not ours', { hello: 'world' }],
    ['the data is a permission banner', { hostId: 'h', worktreeId: 'w', permissionKey: 'k', sends: {} }],
    ['the picks are missing', { hostId: 'h', worktreeId: 'w', questionKey: 'k' }],
    ['a pick is not a number', { ...DATA, picks: { 'question:1': '1' } }]
  ])('sends nothing when %s', async (_label, data) => {
    expect(await run({ data })).toBe('not-an-answer')
    expect(sent).toEqual([])
  })

  it('reports an unroutable host rather than guessing at one', async () => {
    expect(await run({ resolveClient: () => null })).toBe('unroutable')
    expect(sent).toEqual([])
  })

  it('does not answer over a link that is down', async () => {
    state = 'connecting'
    expect(await run()).toBe('offline')
    expect(sent).toEqual([])
  })

  // Failure path: this runs from a notification response handler, sometimes
  // headless, where a rejection reaches nobody.
  it('does not throw when the lookup fails', async () => {
    lookups.mockRejectedValue(new Error('socket closed'))
    expect(await run()).toBe('failed')
  })

  it('reports a send that did not land', async () => {
    expect(await run({ send: async () => false })).toBe('failed')
  })
})
