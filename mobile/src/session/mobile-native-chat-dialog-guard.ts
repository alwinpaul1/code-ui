import { terminalScreenLinesRead } from './mobile-terminal-ask-about-screen-operations'

export const SEND_UNDER_DIALOG_REFUSAL = 'Not sent: a prompt is waiting. Answer it first.'

/** How long a send waits for its look at the screen. A slower read goes
 *  without the look, as a send did before there was one. */
const SCREEN_READ_MS = 2_000

/** A numbered choice: `  2. Lint`, `❯ 1. Yes`, `› 1. Yes, proceed (y)`. */
const OPTION = /^(\s*)(?:([❯›>]) )?(\d+)[.)] \S/
/** A key hint under a menu: "Esc to cancel · Tab to amend", "Enter to select
 *  · ↑/↓ to navigate · Esc to cancel", "Press enter to confirm or esc to
 *  cancel", "ctrl+g to edit in VS Code · …", "shift+tab to approve with this
 *  feedback". */
const HINT = /^\s*(?:press\s+)?(?:esc|enter|tab|shift\+tab|ctrl\+\S+|⏎)\s+to\s\S/i
const RULE = /^\s*[─━═]+…?\s*$/

const indentOf = (row: string): number => row.length - row.trimStart().length

type OptionRow = { index: number; column: number; number: number; selected: boolean }

function optionRow(lines: readonly string[], index: number): OptionRow | null {
  const match = OPTION.exec(lines[index]!)
  if (!match) {
    return null
  }
  const column = match[1]!.length + (match[2] ? 2 : 0)
  return { index, column, number: Number(match[3]), selected: match[2] !== undefined }
}

/**
 * A dialog that reads keys as answers is up: typed text can pick a choice by
 * its digit, and an Enter confirms the highlighted one. On 2026-09-27 a
 * subagent's Bash prompt sat on screen for eight hours with "Yes"
 * highlighted, and a message sent from the chat meanwhile would have
 * approved it.
 *
 * A live dialog REPLACES the input box, so it is the bottom of the screen:
 * a numbered menu 1..n in one column, one of its own rows selected, with
 * nothing under it but blank rows, rules, key hints and its rows' own deeper
 * continuation. Anything else below (the composer, `❯\xa0` on Claude or `› `
 * on Codex, or the status line under it) means the menu is conversation: a
 * sent prompt that answered by number (painted `❯ 1. …` with a plain space),
 * a dialog Claude quoted, a queued message, Codex history, or the chat's own
 * draft typed into Codex's composer (an independent review, 2026-09-27). With
 * no hint under it, the row above the menu must be its question ("Ready to
 * submit your answers?"). Every kind counts the same: a permission prompt, a
 * plan review, an AskUserQuestion on any of its tabs, an open picker.
 * Verified against every capture under fixtures/ and the 2.1.276, 2026-09-05
 * and Codex 0.153.4 captures in mobile-native-chat-dialog-guard.test.ts.
 */
export function terminalDialogOnScreen(lines: readonly string[]): boolean {
  let hinted = false
  const below: number[] = []
  let at = lines.length - 1
  let last: OptionRow | null = null
  for (; at >= 0; at--) {
    last = optionRow(lines, at)
    if (last) {
      break
    }
    const row = lines[at]!
    if (HINT.test(row)) {
      hinted = true
    } else if (row.trim() && !RULE.test(row)) {
      below.push(at)
    }
  }
  if (!last || below.some((index) => indentOf(lines[index]!) <= last.column)) {
    return false
  }
  let selected = last.selected
  let expect = last.number - 1
  let top = last.index
  for (at = last.index - 1; at >= 0 && expect >= 1; at--) {
    const option = optionRow(lines, at)
    if (option && option.column === last.column) {
      if (option.number !== expect) {
        return false
      }
      selected ||= option.selected
      expect -= 1
      top = at
    } else if (lines[at]!.trim() && !RULE.test(lines[at]!) && indentOf(lines[at]!) <= last.column) {
      // Descriptions and wrapped labels sit deeper than the digits; a row at
      // or left of them before option 1 means this is not one menu.
      return false
    }
  }
  if (expect !== 0 || !selected) {
    return false
  }
  if (hinted) {
    return true
  }
  const question = lines.slice(0, top).findLast((row) => row.trim())
  return question !== undefined && /\?\s*$/.test(question)
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
