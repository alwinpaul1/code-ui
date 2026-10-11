import type { MobileChatPermission } from './mobile-native-chat-permission'

/**
 * Claude Code's ExitPlanMode review offers this exact option to reject the
 * plan and say what to change instead of approving it. Verified against a
 * live Claude Code 2.1.276 `claude --permission-mode plan` session
 * (2026-09-18, tmux capture; 2.1.283 draws the review with 2.1.282's code,
 * binaries compared 2026-09-26): the review reads
 *
 *   Claude has written up a plan and is ready to execute. Would you like to proceed?
 *   1. Yes, and use auto mode
 *   2. Yes, manually approve edits
 *   3. Tell Claude what to change
 *
 * "Tell Claude what to change" is plan-review-specific wording, distinct
 * from the Bash/Edit dialogs' "No, and tell Claude what to do differently"
 * (mobile-terminal-permission-options.test.ts). This match is deliberately
 * narrow to that verified phrase — extending it to the Bash/Edit wording
 * would carry an assumption about that dialog's write mechanics this file
 * has not verified (see claude-plan-feedback-send.ts for what plan review
 * specifically needs).
 */
const PLAN_FEEDBACK_OPTION_LABEL_RE = /^Tell Claude what to change\b/i

export function isClaudePlanFeedbackOptionLabel(label: string): boolean {
  return PLAN_FEEDBACK_OPTION_LABEL_RE.test(label.trim())
}

/** The option, if any, that rejects a Claude Code plan review with typed
 *  feedback. Null for every other permission card — Bash, Edit, Codex, a
 *  plain y/n ask — so callers can feature-detect the comment-sheet flow
 *  instead of assuming it applies. */
export function findClaudePlanFeedbackOption(
  permission: MobileChatPermission
): MobileChatPermission['options'][number] | null {
  return permission.options.find((option) => isClaudePlanFeedbackOptionLabel(option.label)) ?? null
}

/** The Claude app's names for the plan review's approvals (1.261009.20:
 *  `ccr_plan_approval_approve_auto`, `ccr_plan_approval_approve`), keyed by
 *  the 2.1.276 wording above and nothing looser: a choice this file has not
 *  seen on a real screen keeps the agent's words rather than gain an
 *  "Approve" it may not mean. */
const PLAN_APPROVALS: readonly (readonly [RegExp, string])[] = [
  [/^Yes, and use auto mode$/i, 'Approve & auto mode'],
  [/^Yes, manually approve edits$/i, 'Approve Plan']
]

/** The Claude app's "Suggest Edits" (`ccr_plan_approval_suggest_edits`) and
 *  the field it opens (`ccr_input_placeholder_suggest_edits`). */
export const PLAN_SUGGEST_EDITS_LABEL = 'Suggest Edits'
export const PLAN_SUGGEST_EDITS_PLACEHOLDER = 'Describe what you’d like changed…'

/** What a plan review's approval is called on the card, or null for any other
 *  choice. Only for a card that is a plan review (it offers the feedback
 *  option); the digit it sends is still the agent's own. */
export function claudePlanApprovalLabel(label: string): string | null {
  const trimmed = label.trim()
  return PLAN_APPROVALS.find(([pattern]) => pattern.test(trimmed))?.[1] ?? null
}
