import { claudePermissionFromScreen } from './claude-terminal-permission'
import { codexPermissionFromScreen } from './codex-terminal-permission'
import { isClaudePlanFeedbackOptionLabel } from './claude-plan-permission'
import { parseTerminalDialogOptions, permissionOptionsFromScreen } from './mobile-terminal-permission-options'
import { terminalScreenLinesRead } from './mobile-terminal-ask-about-screen-operations'

export const SEND_UNDER_DIALOG_REFUSAL = 'Not sent: a prompt is waiting. Answer it first.'

/** How long a send waits for its look at the screen. A slower read goes
 *  without the look, as a send did before there was one. */
const SCREEN_READ_MS = 2_000

/**
 * A dialog on screen that reads keys as answers. While one is up, typed text
 * can pick a choice by its digit and an Enter confirms the highlighted one:
 * on 2026-09-27 a subagent's Bash prompt sat on screen for eight hours with
 * "Yes" highlighted, and a message sent from the chat meanwhile would have
 * approved it.
 *
 * The two readers name the dialogs they know. Any other numbered Yes…/No…
 * menu counts too (Edit, MCP, a title a reader refuses), and so does Claude's
 * plan review, whose third choice is "Tell Claude what to change" rather than
 * a No and whose Enter approves the plan. Either only with one of its rows
 * selected, which a numbered list in the conversation never is. The marker is
 * followed by a plain space on option rows; the prompt's own `❯` takes a
 * no-break space (Claude Code 2.1.270 and later).
 */
export function terminalDialogOnScreen(lines: readonly string[]): boolean {
  if (claudePermissionFromScreen(lines) || codexPermissionFromScreen(lines)) {
    return true
  }
  if (!lines.some((line) => /^\s*[❯›] \d[.)] \S/.test(line))) {
    return false
  }
  return (
    permissionOptionsFromScreen(lines) != null ||
    parseTerminalDialogOptions(lines).some((option) => isClaudePlanFeedbackOptionLabel(option.text))
  )
}

/**
 * Why a composer send must not write now, or null. Read fresh, not from the
 * chat's last poll, which can be seconds old. Fails open: a read that fails,
 * times out or comes from the stream instead of the screen lets the send go,
 * as every send went before this look existed.
 */
export async function readSendUnderDialogRefusal(args: {
  client: Parameters<typeof terminalScreenLinesRead.request>[0]
  terminal: string
  deadline: number
}): Promise<string | null> {
  try {
    const lines = terminalScreenLinesRead.interpret(
      await terminalScreenLinesRead.request(
        args.client,
        { terminal: args.terminal, screen: true },
        {
          timeoutMs: Math.max(1, Math.min(SCREEN_READ_MS, args.deadline - Date.now())),
          budgetSpansConnect: true
        }
      )
    )
    return lines && terminalDialogOnScreen(lines) ? SEND_UNDER_DIALOG_REFUSAL : null
  } catch {
    return null
  }
}
