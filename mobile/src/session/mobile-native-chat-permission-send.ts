import { useCallback, type MutableRefObject } from 'react'
import { planFeedbackScreenRead } from './claude-plan-feedback-operations'
import { highlightedPlanOptionDigit } from './claude-plan-feedback-send'
import { findClaudePlanFeedbackOption } from './claude-plan-permission'
import { claudePermissionFromScreen } from './claude-terminal-permission'
import { codexPermissionFromScreen } from './codex-terminal-permission'
import type { MobileChatPermission } from './mobile-native-chat-permission'
import type { RpcClient } from '../transport/rpc-client'
import {
  sendMobileNativeChatMessageWithOutcome,
  type MobileNativeChatSendOutcome
} from './mobile-native-chat-send'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'

/** A tap this path looked at the screen for and declined to write, with the
 *  reason in the user's terms. The three string outcomes are the write's. */
export type MobileNativeChatPermissionRefusal = { kind: 'refused'; message: string }

export type MobileNativeChatPermissionResponseOutcome =
  | MobileNativeChatSendOutcome
  | MobileNativeChatPermissionRefusal

export const CLAUDE_PLAN_FEEDBACK_ROW_HIGHLIGHTED_MESSAGE =
  'The terminal is waiting for typed feedback. Press Up in the terminal, or send your comment from here.'

/**
 * Whether a plan-review approval digit may go out right now, or why not.
 *
 * Claude Code 2.1.276 (tmux capture, 2026-09-18): once the review's `❯`
 * sits on "Tell Claude what to change", a digit is typed INTO that row
 * (`❯ 3. 1`) instead of choosing an option, and the review stays up. A
 * refused comment send (claude-plan-feedback-send.ts, fact 4) can leave the
 * desktop there. So a plan card's approval tap looks once first and refuses
 * while that row is highlighted. Anything short of a live frame with the
 * `❯` on another row is a guess, and the digit is not written on a guess.
 */
async function planApprovalRefusal(args: {
  client: RpcClient
  terminal: string
  feedbackDigit: string
}): Promise<MobileNativeChatPermissionRefusal | 'rejected' | null> {
  const screen = planFeedbackScreenRead.interpret(
    await planFeedbackScreenRead.request(
      args.client,
      { terminal: args.terminal, screen: true },
      { timeoutMs: 4_000, budgetSpansConnect: true }
    )
  )
  if (screen == null || !screen.isScreen) {
    return 'rejected'
  }
  const highlighted = highlightedPlanOptionDigit(screen.lines)
  if (highlighted == null) {
    return 'rejected'
  }
  return highlighted === args.feedbackDigit
    ? { kind: 'refused', message: CLAUDE_PLAN_FEEDBACK_ROW_HIGHLIGHTED_MESSAGE }
    : null
}

export async function sendMobileNativeChatPermissionResponse(args: {
  client: RpcClient
  terminal: string
  deviceToken: string | null
  text: string
  expectedTerminalAgent?: string | null
  expectedCodexPermission?: MobileChatPermission | null
  /** The card the tap came from, as rendered. Plan reviews are known only
   *  from it: the screen parser cannot see that dialog. */
  cardPermission?: MobileChatPermission | null
}): Promise<MobileNativeChatPermissionResponseOutcome> {
  if (args.expectedCodexPermission) {
    // Recheck the visible command before sending a shortcut. A stale card
    // must not approve a different command after a reconnect or desktop click.
    try {
      const response = await args.client.sendRequest(
        'terminal.read',
        { terminal: args.terminal, screen: true },
        { timeoutMs: 4_000, budgetSpansConnect: true }
      )
      if (!response.ok) {
        return 'rejected'
      }
      const result = response.result as { terminal?: { tail?: unknown; lines?: unknown } }
      const raw = result?.terminal?.tail ?? result?.terminal?.lines
      const lines = Array.isArray(raw)
        ? raw.filter((line): line is string => typeof line === 'string')
        : []
      const current =
        args.expectedTerminalAgent === 'claude' || args.expectedTerminalAgent === 'openclaude'
          ? claudePermissionFromScreen(lines)
          : codexPermissionFromScreen(lines)
      if (
        JSON.stringify(current) !== JSON.stringify(args.expectedCodexPermission) ||
        !current?.options.some((option) => option.send === args.text)
      ) {
        return 'rejected'
      }
    } catch {
      return 'rejected'
    }
  }
  // Only a plan-review card, found by its own option label (the recogniser
  // claude-plan-permission.ts already uses): Bash/Edit and Codex cards keep
  // the single recheck above and gain no read here.
  const feedbackOption = args.cardPermission
    ? findClaudePlanFeedbackOption(args.cardPermission)
    : null
  if (feedbackOption) {
    try {
      const refusal = await planApprovalRefusal({
        client: args.client,
        terminal: args.terminal,
        feedbackDigit: feedbackOption.send
      })
      if (refusal) {
        return refusal
      }
    } catch {
      return 'rejected'
    }
  }
  // Why: approval choices are already complete terminal control sequences;
  // appending Return changes both numbered choices and Escape denial.
  return sendMobileNativeChatMessageWithOutcome({
    client: args.client,
    terminal: args.terminal,
    text: args.text,
    enter: false,
    ...(args.deviceToken ? { mobileClient: { id: args.deviceToken, type: 'mobile' as const } } : {})
  })
}

export function useMobileNativeChatPermissionSend(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  onSendError: (message: string) => void
  expectedTerminalAgent?: string | null
  onResponseAccepted?: () => void
  expectedCodexPermission?: MobileChatPermission | null
  cardPermission?: MobileChatPermission | null
}): (text: string) => Promise<boolean> {
  return useCallback(
    async (text: string): Promise<boolean> => {
      const terminal = args.handleRef.current
      if (!args.client || !terminal || !args.enabled) {
        args.onSendError('Response not sent (disconnected)')
        return false
      }
      // A choice keystroke must not interleave into a mid-flight composed write
      // (image paste, paced answer) on the same PTY.
      if (!acquireMobileNativeChatTerminalWrite(terminal)) {
        args.onSendError('Response not sent')
        return false
      }
      // No stale-input heal here (unlike the text/ask sends): a choice is an
      // `enter: false` key for an active overlay that swallows the clear, so it
      // would consume the marker still protecting the next real message.
      let outcome: MobileNativeChatPermissionResponseOutcome
      try {
        outcome = await sendMobileNativeChatPermissionResponse({
          client: args.client,
          terminal,
          deviceToken: args.deviceTokenRef.current,
          text,
          expectedCodexPermission: args.expectedCodexPermission,
          expectedTerminalAgent: args.expectedTerminalAgent,
          cardPermission: args.cardPermission
        })
      } finally {
        releaseMobileNativeChatTerminalWrite(terminal)
      }
      if (typeof outcome !== 'string') {
        // Nothing was written; the message says what the terminal wants.
        args.onSendError(outcome.message)
        return false
      }
      if (outcome === 'unknown') {
        // Why: the response may have been delivered (ack lost / path cutover) —
        // a definite "not sent" would invite a double answer.
        args.onSendError('Response unconfirmed — check chat before retrying')
      } else if (outcome === 'rejected') {
        args.onSendError('Response not sent')
      }
      if (outcome === 'accepted') {
        args.onResponseAccepted?.()
      }
      return outcome === 'accepted'
    },
    [
      args.cardPermission,
      args.client,
      args.deviceTokenRef,
      args.enabled,
      args.expectedCodexPermission,
      args.expectedTerminalAgent,
      args.onResponseAccepted,
      args.handleRef,
      args.onSendError
    ]
  )
}
