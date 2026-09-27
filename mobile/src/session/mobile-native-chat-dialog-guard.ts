import { isClaudePlanFeedbackOptionLabel } from './claude-plan-permission'
import { terminalScreenLinesRead } from './mobile-terminal-ask-about-screen-operations'

export const SEND_UNDER_DIALOG_REFUSAL = 'Not sent: a prompt is waiting. Answer it first.'

/** How long a send waits for its look at the screen. A slower read goes
 *  without the look, as a send did before there was one. */
const SCREEN_READ_MS = 2_000

/** A numbered choice: `  2. Lint`, `❯ 1. Yes`, `› 1. Yes, proceed (y)`. */
const OPTION = /^(\s*)(?:([❯›>]) )?(\d+)[.)] (\S.*?)\s*$/
/** A key hint under a menu: "Esc to cancel · Tab to amend", "Enter to select
 *  · ↑/↓ to navigate · Esc to cancel", "Press enter to confirm or esc to
 *  cancel", "ctrl+g to edit in VS Code · …", "shift+tab to approve with this
 *  feedback". */
const HINT = /^\s*(?:press\s+)?(?:esc|enter|tab|shift\+tab|ctrl\+\S+|⏎)\s+to\s\S/i
const RULE = /^\s*[─━═]+…?\s*$/
/** Claude's own input row: `❯` then a no-break space (2.1.270 and later), or
 *  a bare `❯` once a reader trims that space. A sent prompt takes a plain one. */
const CLAUDE_INPUT = /^\s*❯(?:\u00a0|$)/

const indentOf = (row: string): number => row.length - row.trimStart().length
const blankOrRule = (row: string): boolean => !row.trim() || RULE.test(row)

type OptionRow = { index: number; column: number; number: number; selected: boolean; label: string }

function optionRow(lines: readonly string[], index: number): OptionRow | null {
  const match = OPTION.exec(lines[index]!)
  if (!match) {
    return null
  }
  const column = match[1]!.length + (match[2] ? 2 : 0)
  return { index, column, number: Number(match[3]), selected: match[2] !== undefined, label: match[4]! }
}

/** What the up dialog asks for: an answer to a permission or plan prompt, or a
 *  pick from a menu (an ask, a picker). The chat words its notice by it. */
export type TerminalDialogKind = 'approval' | 'menu'

/**
 * A dialog that reads keys as answers is up: typed text can pick a choice by
 * its digit, and an Enter confirms the highlighted one. On 2026-09-27 a
 * subagent's Bash prompt sat on screen for eight hours with "Yes"
 * highlighted, and a message sent from the chat meanwhile would have
 * approved it.
 *
 * A live dialog REPLACES the input box, so it is the bottom of the screen:
 * a numbered menu 1..n in one column, one of its own rows selected, with
 * nothing under it but blank rows, rules, key hints (and a hint's wrapped
 * tail, which Ink starts again at the hint's own column) and its rows' deeper
 * continuation. Anything else below (Codex's `› ` input and its status row)
 * means the menu is conversation: a sent prompt that answered by number
 * (painted `❯ 1. …` with a plain space), a dialog Claude quoted, a queued
 * message, Codex history, or the chat's own draft in Codex's input. Claude's
 * input row itself (`❯\xa0`) is never on screen with a live dialog, so a
 * screen that shows it has none, whatever its draft quotes. With no hint
 * under it, the row above the menu must be its question ("Ready to submit
 * your answers?"). Claude's plan review is named by its own "Tell Claude what
 * to change" at any width, whatever is drawn under it. An independent review
 * (2026-09-27) found each of the conversation shapes, and the wrapped hint,
 * read the wrong way.
 * Verified against every capture under fixtures/ and the 2.1.276, 2026-09-05
 * and Codex 0.153.4 captures in mobile-native-chat-dialog-guard.test.ts.
 */
export function terminalDialogKind(lines: readonly string[]): TerminalDialogKind | null {
  if (lines.some((row) => CLAUDE_INPUT.test(row))) {
    return null
  }
  let last: OptionRow | null = null
  for (let at = lines.length - 1; at >= 0 && !last; at--) {
    last = optionRow(lines, at)
  }
  if (!last) {
    return null
  }
  // Under the menu, top down: a hint's wrapped tail runs on from it to the
  // next blank row or rule.
  let hinted = false
  let inHint = false
  let underIsItsOwn = true
  for (let at = last.index + 1; at < lines.length; at++) {
    const row = lines[at]!
    if (blankOrRule(row)) {
      inHint = false
    } else if (HINT.test(row)) {
      hinted = inHint = true
    } else if (!inHint && indentOf(row) <= last.column) {
      underIsItsOwn = false
    }
  }
  const options = [last]
  for (let at = last.index - 1; at >= 0 && options[0]!.number > 1; at--) {
    const option = optionRow(lines, at)
    if (option && option.column === last.column) {
      if (option.number !== options[0]!.number - 1) {
        return null
      }
      options.unshift(option)
    } else if (!blankOrRule(lines[at]!) && indentOf(lines[at]!) <= last.column) {
      // Descriptions and wrapped labels sit deeper than the digits; a row at
      // or left of them before option 1 means this is not one menu.
      return null
    }
  }
  if (options[0]!.number !== 1 || !options.some((option) => option.selected)) {
    return null
  }
  const labels = options.map((option) => option.label)
  const planReview = labels.some(isClaudePlanFeedbackOptionLabel)
  if (!planReview) {
    const question = lines.slice(0, options[0]!.index).findLast((row) => row.trim())
    if (!underIsItsOwn || (!hinted && !(question !== undefined && /\?\s*$/.test(question)))) {
      return null
    }
  }
  const approval =
    planReview || (labels.some((label) => /^yes\b/i.test(label)) && labels.some((label) => /^no\b/i.test(label)))
  return approval ? 'approval' : 'menu'
}

export function terminalDialogOnScreen(lines: readonly string[]): boolean {
  return terminalDialogKind(lines) !== null
}

/**
 * Why a write from the chat must not go now, or null. Read fresh, not from the
 * chat's last poll, which can be seconds old. Fails open: a read that fails,
 * times out or comes from the stream instead of the screen lets the send go,
 * as every send went before this look existed.
 */
export async function readSendUnderDialogRefusal(args: {
  client: Parameters<typeof terminalScreenLinesRead.request>[0]
  terminal: string
  /** The action's own budget, when it has one; the look never takes longer. */
  deadline?: number
}): Promise<string | null> {
  try {
    const lines = terminalScreenLinesRead.interpret(
      await terminalScreenLinesRead.request(
        args.client,
        { terminal: args.terminal, screen: true },
        {
          timeoutMs: Math.max(1, Math.min(SCREEN_READ_MS, (args.deadline ?? Infinity) - Date.now())),
          budgetSpansConnect: true
        }
      )
    )
    return lines && terminalDialogOnScreen(lines) ? SEND_UNDER_DIALOG_REFUSAL : null
  } catch {
    return null
  }
}

/** Runs `look`, says its refusal through `report`, and answers whether the
 *  write must stop. */
export async function refusedUnderDialog(
  look: typeof readSendUnderDialogRefusal,
  args: Parameters<typeof readSendUnderDialogRefusal>[0],
  report: (message: string) => void
): Promise<boolean> {
  const refusal = await look(args)
  if (refusal) {
    report(refusal)
  }
  return refusal !== null
}
