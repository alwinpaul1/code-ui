import type { MobileChatPermission } from './mobile-native-chat-permission'

/**
 * Claude Code's ExitPlanMode review offers this exact option to reject the
 * plan and say what to change instead of approving it. Verified against a
 * live Claude Code 2.1.276 `claude --permission-mode plan` session
 * (2026-09-18, tmux capture): the review reads
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
