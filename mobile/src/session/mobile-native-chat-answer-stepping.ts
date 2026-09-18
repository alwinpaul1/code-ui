import type { AskAnswerKeyGroup } from '../../../src/shared/native-chat-ask'
import {
  nativeChatQuestionOffsets,
  scheduleNativeChatAnswer,
  NATIVE_CHAT_ADVANCE_BUFFER_MS,
  NATIVE_CHAT_QUESTION_STEP_MS,
  NATIVE_CHAT_SUBMIT_DELAY_MS
} from '../../../src/shared/native-chat-answer-stepping'

export const MOBILE_NATIVE_CHAT_ADVANCE_BUFFER_MS = NATIVE_CHAT_ADVANCE_BUFFER_MS
export const MOBILE_NATIVE_CHAT_QUESTION_STEP_MS = NATIVE_CHAT_QUESTION_STEP_MS
export const MOBILE_NATIVE_CHAT_SUBMIT_DELAY_MS = NATIVE_CHAT_SUBMIT_DELAY_MS
export const mobileNativeChatQuestionOffsets = nativeChatQuestionOffsets
export const scheduleMobileClaudeAnswer = scheduleNativeChatAnswer

/** A free-text answer is written as raw keystrokes into the selector's "Type
 *  something" row (terminal.send has no paste framing), so an embedded newline
 *  would submit it early — collapse line breaks to spaces. */
export function sanitizeAskFreeText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ')
}

export type AskAnswerStepOutcome =
  | { kind: 'sent' }
  /** Superseded or torn down before every group was written. */
  | { kind: 'cancelled' }
  /** The write at `step` (0-based group index) was not accepted; nothing after it was tried. */
  | { kind: 'failed'; step: number }
  /** An empty plan: nothing was written, and that is not a success. */
  | { kind: 'nothing-to-send' }

/**
 * Write one answer's keystroke groups to the agent's selector, a step apart.
 *
 * This is the ONE sequencer. The chat card's hook and the notification shade
 * both answer an AskUserQuestion through it: same order, same pacing, same
 * budget rule. A navigation keystroke batched with the next one commits before
 * the selector has applied it, which is why each group waits a step before the
 * next lands (verified live against Claude Code's TUI — see
 * `buildAskAnswerKeys`). The pause is deliberate, not transport latency, so it
 * is credited back to the shared budget rather than charged against it: a long
 * multi-question answer still gets a full budget to write in.
 *
 * Owns none of the transport, the cancellation or the lock — the caller passes
 * a `write` that knows its client, a `wait` that knows how it is cancelled, and
 * a `cancelled` probe checked before every write.
 */
export async function stepAskAnswerKeyGroups(args: {
  groups: readonly AskAnswerKeyGroup[]
  /** Budget for the whole answer; each pause between groups is credited back. */
  deadline: number
  /** True once this answer has been superseded; nothing more is written after that. */
  cancelled?: () => boolean
  /** Write one group under the given budget; resolves true when the write was accepted. */
  write: (body: string, deadline: number) => Promise<boolean>
  /** Pause between groups; resolves false when the pause was cut short. */
  wait: (ms: number) => Promise<boolean>
}): Promise<AskAnswerStepOutcome> {
  const { groups } = args
  if (groups.length === 0) {
    return { kind: 'nothing-to-send' }
  }
  let deadline = args.deadline
  for (let index = 0; index < groups.length; index += 1) {
    if (args.cancelled?.() === true) {
      return { kind: 'cancelled' }
    }
    const group = groups[index]!
    const body = 'raw' in group ? group.raw : sanitizeAskFreeText(group.text)
    if (!(await args.write(body, deadline))) {
      return { kind: 'failed', step: index }
    }
    if (index < groups.length - 1) {
      if (!(await args.wait(MOBILE_NATIVE_CHAT_QUESTION_STEP_MS))) {
        return { kind: 'cancelled' }
      }
      deadline += MOBILE_NATIVE_CHAT_QUESTION_STEP_MS
    }
  }
  return { kind: 'sent' }
}
