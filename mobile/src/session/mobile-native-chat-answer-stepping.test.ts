import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskAnswerKeyGroup } from '../../../src/shared/native-chat-ask'
import {
  mobileNativeChatQuestionOffsets,
  scheduleMobileClaudeAnswer,
  stepAskAnswerKeyGroups,
  MOBILE_NATIVE_CHAT_ADVANCE_BUFFER_MS,
  MOBILE_NATIVE_CHAT_QUESTION_STEP_MS,
  MOBILE_NATIVE_CHAT_SUBMIT_DELAY_MS
} from './mobile-native-chat-answer-stepping'

describe('mobileNativeChatQuestionOffsets', () => {
  it('matches the desktop cadence constants', () => {
    expect(MOBILE_NATIVE_CHAT_SUBMIT_DELAY_MS).toBe(500)
    expect(MOBILE_NATIVE_CHAT_ADVANCE_BUFFER_MS).toBe(500)
    expect(MOBILE_NATIVE_CHAT_QUESTION_STEP_MS).toBe(1000)
  })

  it('paces each question a full step apart, Enter 500ms after its body', () => {
    expect(mobileNativeChatQuestionOffsets(0)).toEqual({ bodyAt: 0, enterAt: 500 })
    expect(mobileNativeChatQuestionOffsets(1)).toEqual({ bodyAt: 1000, enterAt: 1500 })
    expect(mobileNativeChatQuestionOffsets(2)).toEqual({ bodyAt: 2000, enterAt: 2500 })
  })
})

describe('scheduleMobileClaudeAnswer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('writes each question body then its Enter, paced per step, one Enter per line', () => {
    const events: string[] = []
    const timers = scheduleMobileClaudeAnswer(
      ['', 'b', 'c'], // blank middle answer must still get its own body + Enter
      (line) => events.push(`body:${line}`),
      () => events.push('enter')
    )
    expect(timers).toHaveLength(6)

    vi.advanceTimersByTime(0)
    expect(events).toEqual(['body:'])
    vi.advanceTimersByTime(MOBILE_NATIVE_CHAT_SUBMIT_DELAY_MS)
    expect(events).toEqual(['body:', 'enter'])
    vi.advanceTimersByTime(MOBILE_NATIVE_CHAT_ADVANCE_BUFFER_MS)
    expect(events).toEqual(['body:', 'enter', 'body:b'])

    vi.runAllTimers()
    expect(events).toEqual(['body:', 'enter', 'body:b', 'enter', 'body:c', 'enter'])
  })

  it('cancelling the returned timers stops all pending writes', () => {
    const events: string[] = []
    const timers = scheduleMobileClaudeAnswer(
      ['a', 'b'],
      (line) => events.push(`body:${line}`),
      () => events.push('enter')
    )
    for (const timer of timers) {
      clearTimeout(timer)
    }
    vi.runAllTimers()
    expect(events).toEqual([])
  })
})

/**
 * The one place an answer's keystroke groups are written a step apart. The
 * chat card's hook and the notification shade both answer a selector through
 * it; a second copy of this loop is how the two would drift — one crediting
 * the pacing back to the budget, the other timing out a long answer.
 */
describe('stepping an answer through the agent selector', () => {
  function harness(groups: AskAnswerKeyGroup[], accept: (body: string) => boolean = () => true) {
    const writes: { body: string; deadline: number }[] = []
    const waits: number[] = []
    return {
      writes,
      waits,
      run: (overrides: Partial<Parameters<typeof stepAskAnswerKeyGroups>[0]> = {}) =>
        stepAskAnswerKeyGroups({
          groups,
          deadline: 10_000,
          write: async (body, deadline) => {
            writes.push({ body, deadline })
            return accept(body)
          },
          wait: async (ms) => {
            waits.push(ms)
            return true
          },
          ...overrides
        })
    }
  }

  it('writes the groups in order, pausing one step between them and not after the last', async () => {
    const h = harness([{ raw: '2' }, { raw: '\x1b[C' }, { raw: '\r' }])
    expect(await h.run()).toEqual({ kind: 'sent' })
    expect(h.writes.map((w) => w.body)).toEqual(['2', '\x1b[C', '\r'])
    expect(h.waits).toEqual([MOBILE_NATIVE_CHAT_QUESTION_STEP_MS, MOBILE_NATIVE_CHAT_QUESTION_STEP_MS])
  })

  // Pacing is deliberate, not transport latency: each pause is credited back so
  // a long multi-question answer keeps a full budget to actually write in.
  it('credits each pacing pause back to the shared budget', async () => {
    const h = harness([{ raw: '1' }, { raw: '2' }, { raw: '\r' }])
    await h.run()
    expect(h.writes.map((w) => w.deadline)).toEqual([
      10_000,
      10_000 + MOBILE_NATIVE_CHAT_QUESTION_STEP_MS,
      10_000 + 2 * MOBILE_NATIVE_CHAT_QUESTION_STEP_MS
    ])
  })

  // A free-text answer is typed into the selector's "Type something" row as
  // raw keystrokes, so an embedded newline would submit it early.
  it('flattens line breaks in a typed answer', async () => {
    const h = harness([{ raw: '3' }, { text: 'first line\r\nsecond' }, { raw: '\r' }])
    await h.run()
    expect(h.writes[1]!.body).toBe('first line second')
  })

  it('stops at the first refused write and says which step it was', async () => {
    const h = harness([{ raw: '1' }, { raw: '2' }, { raw: '\r' }], (body) => body !== '2')
    expect(await h.run()).toEqual({ kind: 'failed', step: 1 })
    expect(h.writes.map((w) => w.body)).toEqual(['1', '2'])
  })

  it('writes nothing once the answer has been superseded', async () => {
    const h = harness([{ raw: '1' }, { raw: '\r' }])
    expect(await h.run({ cancelled: () => true })).toEqual({ kind: 'cancelled' })
    expect(h.writes).toEqual([])
  })

  it('stops when the pause between steps is cut short', async () => {
    const h = harness([{ raw: '1' }, { raw: '\r' }])
    const wait = vi.fn(async () => false)
    expect(await h.run({ wait })).toEqual({ kind: 'cancelled' })
    expect(h.writes.map((w) => w.body)).toEqual(['1'])
  })

  // Degenerate: nothing to write is not a success.
  it('reports an empty plan rather than calling it sent', async () => {
    const h = harness([])
    expect(await h.run()).toEqual({ kind: 'nothing-to-send' })
    expect(h.writes).toEqual([])
    expect(h.waits).toEqual([])
  })

  it('writes a single group with no pause at all', async () => {
    const h = harness([{ raw: '2' }])
    expect(await h.run()).toEqual({ kind: 'sent' })
    expect(h.writes.map((w) => w.body)).toEqual(['2'])
    expect(h.waits).toEqual([])
  })
})
