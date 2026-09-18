import type { RpcClient } from '../transport/rpc-client'
import { buildTerminalSendParams } from '../terminal/terminal-send-request'
import { planFeedbackScreenRead, planFeedbackWrite } from './claude-plan-feedback-operations'

export type ClaudePlanFeedbackOutcome =
  | { kind: 'sent' }
  | { kind: 'refused'; message: string }
  | { kind: 'failed' }

export const CLAUDE_PLAN_FEEDBACK_REFUSAL_MESSAGE =
  "Couldn't hand the comment over — type it in the terminal"

function highlightedOptionLine(digit: string): RegExp {
  return new RegExp(`^\\s*[❯›>]\\s*${digit}[.)]\\s`)
}

/**
 * Reject a Claude Code plan review with the user's typed feedback, or a
 * plain reject when there is none.
 *
 * Verified against a live Claude Code 2.1.276 `claude --permission-mode plan`
 * session (2026-09-18, tmux capture) — three real, load-bearing facts this
 * function depends on, none of which held for the Bash/Edit dialogs already
 * shipped elsewhere in this file's neighbors:
 *
 *  1. The digit alone does not submit. Unlike Bash/Edit's numbered dialog,
 *     sending the reject option's digit only moves the highlighted row; the
 *     screen keeps showing the same three choices until Enter confirms one.
 *  2. Typing while the reject row is highlighted replaces its rendered
 *     label in place with the typed text (confirmed by sending a single
 *     literal character and re-reading the screen). Enter then submits that
 *     text as the rejection reason — "Plan cut to two sentences" was the
 *     agent's own next line after typing "Use two sentences instead." and
 *     pressing Enter.
 *  3. Shift+Tab does something else entirely: it approves the plan and
 *     switches to auto mode (same as choosing option 1), then sends
 *     whatever was typed as a brand new chat message. The on-screen hint
 *     ("shift+tab to approve with this feedback") reads as if it submitted
 *     the rejection, and it does not — never send it here.
 */
export async function sendClaudePlanFeedback(args: {
  client: RpcClient
  terminal: string
  deviceToken: string | null
  optionSend: string
  comment: string
}): Promise<ClaudePlanFeedbackOutcome> {
  const comment = args.comment.trim()
  try {
    if (args.client.getState() !== 'connected') {
      return { kind: 'failed' }
    }

    if (comment.length === 0) {
      // Plain reject: the digit alone only moves the cursor here, so Enter is
      // part of this one write, not a second write.
      const accepted = planFeedbackWrite.interpret(
        await planFeedbackWrite.request(
          args.client,
          buildTerminalSendParams({
            terminal: args.terminal,
            text: args.optionSend,
            enter: true,
            deviceToken: args.deviceToken
          })
        )
      )
      return accepted === true ? { kind: 'sent' } : { kind: 'failed' }
    }

    // Step 1: move the highlight to the reject option. No Enter yet — typing
    // over that row, not a second keypress, is how the CLI accepts a comment.
    const selected = planFeedbackWrite.interpret(
      await planFeedbackWrite.request(
        args.client,
        buildTerminalSendParams({
          terminal: args.terminal,
          text: args.optionSend,
          enter: false,
          deviceToken: args.deviceToken
        })
      )
    )
    if (selected !== true) {
      return { kind: 'failed' }
    }

    // Step 2: re-read the screen and refuse rather than guess when the
    // highlighted row isn't the one just selected.
    const screen = planFeedbackScreenRead.interpret(
      await planFeedbackScreenRead.request(args.client, {
        terminal: args.terminal,
        screen: true
      })
    )
    const confirmed =
      screen != null &&
      screen.isScreen &&
      screen.lines.some((line) => highlightedOptionLine(args.optionSend).test(line))
    if (!confirmed) {
      return { kind: 'refused', message: CLAUDE_PLAN_FEEDBACK_REFUSAL_MESSAGE }
    }

    // Step 3: type the comment and submit it.
    const sent = planFeedbackWrite.interpret(
      await planFeedbackWrite.request(
        args.client,
        buildTerminalSendParams({
          terminal: args.terminal,
          text: comment,
          enter: true,
          deviceToken: args.deviceToken
        })
      )
    )
    return sent === true ? { kind: 'sent' } : { kind: 'failed' }
  } catch {
    return { kind: 'failed' }
  }
}
