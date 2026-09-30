// The cost of reading a waiting agent's reply for the question card, on the
// render path (use-mobile-native-chat-prompts.ts calls parseAgentQuestion on
// every render while the agent waits). The scan for a line that asks after
// the choices (asksAfter) checked every line against every later list:
// 376 ms for choices followed by 5,000 notes lists (2026-09-30).
import { describe, expect, it } from 'vitest'
import { parseAgentQuestion } from './mobile-native-chat-question'

describe('a reply whose choices are followed by thousands of notes lists', () => {
  it('is read in a few milliseconds, and keeps the choices', () => {
    const reply = `Which?\n1. a\n2. b\n\n${'Notes:\n- x\n\n'.repeat(5_000)}`
    parseAgentQuestion(reply)
    const started = performance.now()
    let question = parseAgentQuestion(reply)
    for (let run = 1; run < 5; run += 1) {
      question = parseAgentQuestion(reply)
    }
    expect(question?.question).toBe('Which?')
    expect(question?.options).toEqual(['a', 'b'])
    expect((performance.now() - started) / 5).toBeLessThan(80)
  })
})
