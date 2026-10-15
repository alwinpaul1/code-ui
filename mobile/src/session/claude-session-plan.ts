import type { NativeChatMessage, NativeChatToolResultBlock } from '../../../src/shared/native-chat-types'
import { findClaudePlanFeedbackOption } from './claude-plan-permission'
import type { MobileChatPermission } from './mobile-native-chat-permission'

/**
 * The plan a matched Claude tab's "Plan" pill opens, as the Claude app's session bar draws it
 * (1.261013.20: `session_pill_plan` "Plan", read "Open plan" `ccr_session_bar_open_plan`,
 * ns30.java:610-651 and u8z.java:3806). The app shows it once Claude has proposed a plan and not
 * while that plan's approval is asked (ys8.d: a plan, no pending plan prompt); plan mode alone
 * draws no pill. The plan is ExitPlanMode's `plan` input, the newest one in the conversation.
 *
 * The app keeps the proposed plan from its live prompt; Code UI reads it from the conversation,
 * so a plan proposed before the phone opened the session still has its pill.
 *
 * A plan the user turned down draws no pill, and the pill does not fall back to an older plan
 * then: the newest proposal is the one that counts (review 2026-10-15, the pill opened a rejected
 * plan). A turn-down is ExitPlanMode's result flagged as an error, or worded as Claude Code words
 * a rejection, cancel or denial.
 *
 * UNPROVEN against the app: an approved plan keeps its pill across every later turn, until a newer
 * plan replaces it. Whether the Claude app drops the pill once the plan's work is done, or at a new
 * prompt, has not been watched on a device; this keeps the plan until shown otherwise.
 */
export function claudeSessionPlan(messages: readonly NativeChatMessage[], permission: MobileChatPermission | null | undefined): string | null {
  if (permission && findClaudePlanFeedbackOption(permission) !== null) {
    return null
  }
  return newestPlan(messages)
}

const cache = new WeakMap<readonly NativeChatMessage[], string | null>()

function newestPlan(messages: readonly NativeChatMessage[]): string | null {
  const known = cache.get(messages)
  if (known !== undefined) {
    return known
  }
  let found: string | null = null
  // Results seen so far, walking back from the newest: by callId, and the nearest one naming no
  // call, for pairing by position.
  const answers = new Map<string, NativeChatToolResultBlock>()
  let unnamed: NativeChatToolResultBlock | null = null
  search: for (let index = messages.length - 1; index >= 0; index -= 1) {
    const blocks = messages[index]?.blocks ?? []
    for (let at = blocks.length - 1; at >= 0; at -= 1) {
      const block = blocks[at]
      if (block?.type === 'tool-result') {
        if (block.callId) {
          answers.set(block.callId, block)
        } else {
          unnamed = block
        }
        continue
      }
      if (block?.type !== 'tool-call') {
        continue
      }
      // Its own result by id, else the nearest result that names no call (either side may lack the
      // id, as mobile-native-chat-turn-segments.ts pairs them); a call takes that result once.
      const named = block.callId ? answers.get(block.callId) : undefined
      const answer = named ?? unnamed
      if (named === undefined) {
        unnamed = null
      }
      if (block.name.trim() !== 'ExitPlanMode') {
        continue
      }
      const plan = planOf(block.input)
      if (plan !== null) {
        // The newest proposal decides: turned down, there is no plan to open, not an older one.
        found = answer !== null && turnedDown(answer) ? null : plan
        break search
      }
    }
  }
  cache.set(messages, found)
  return found
}

/** Claude Code's answers to a call the user did not let run (mobile-background-task-transcript.ts
 *  words the same ones): a turn-down, a cancel, a denial, a tool error, or its plan rejection. */
const TURNED_DOWN =
  /^\s*(?:<tool_use_error>|The user doesn't want to (?:proceed with this tool use|take this action right now)|Permission (?:for this |to use )[\s\S]*?(?:was|has been) denied|User rejected)/

function turnedDown(result: NativeChatToolResultBlock): boolean {
  return result.isError === true || TURNED_DOWN.test(result.output)
}

function planOf(input: unknown): string | null {
  let value = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch {
      return null
    }
  }
  const plan = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).plan : null
  return typeof plan === 'string' && plan.trim().length > 0 ? plan : null
}
