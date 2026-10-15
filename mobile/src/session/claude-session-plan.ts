import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
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
  for (let index = messages.length - 1; index >= 0 && found === null; index -= 1) {
    const blocks = messages[index]?.blocks ?? []
    for (let at = blocks.length - 1; at >= 0; at -= 1) {
      const block = blocks[at]
      if (block?.type === 'tool-call' && block.name.trim() === 'ExitPlanMode') {
        const plan = planOf(block.input)
        if (plan !== null) {
          found = plan
          break
        }
      }
    }
  }
  cache.set(messages, found)
  return found
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
