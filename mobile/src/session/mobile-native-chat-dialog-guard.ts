import { isClaudePlanFeedbackOptionLabel } from './claude-plan-permission'
import { claudeComposerLive } from './claude-composer-screen'
import { codexComposerLive } from './codex-composer-screen'
import { lookAtScreen } from './mobile-native-chat-screen-look'
import { MOBILE_NATIVE_CHAT_SEND_WRITE_RESERVE_MS } from './mobile-native-chat-send-readiness'
import { replyIsScreen, terminalScreenLinesRead } from './mobile-terminal-ask-about-screen-operations'

export const SEND_UNDER_DIALOG_REFUSAL = 'Not sent: a prompt is waiting. Answer it first.'

/** Said when a screen that can be read does not show Claude's input box. */
export const SEND_WITHOUT_COMPOSER_REFUSAL =
  "Claude's input box isn't on the desktop screen, so the message was not typed."

/** Said when the host answered that it has no screen to show for the terminal. */
export const SEND_SCREEN_UNAVAILABLE_REFUSAL =
  'The desktop has no screen to show for this terminal yet, so the message was not typed.'

/** Said when a screen that can be read does not show Codex's input box. */
export const SEND_WITHOUT_CODEX_COMPOSER_REFUSAL =
  "Codex's input box isn't on the desktop screen, so the message was not typed."

/** Said when a read of the screen failed on a host that has shown its screen. */
export const SEND_SCREEN_UNREADABLE_REFUSAL =
  "Couldn't read the desktop screen, so the message was not typed. Send again."

/** A numbered choice: `  2. Lint`, `❯ 1. Yes`, `› 1. Yes, proceed (y)`. */
const OPTION = /^(\s*)(?:([❯›>]) )?(\d+)[.)] (\S.*?)\s*$/
const HINT_KEY = String.raw`(?:esc|enter|tab|shift\+tab|ctrl\+\S+|⏎)`
/** A key hint under a menu: "Esc to cancel · Tab to amend", "Enter to select
 *  · ↑/↓ to navigate · Esc to cancel", "Press enter to confirm or esc to
 *  cancel", "ctrl+g to edit in VS Code · …", "shift+tab to approve with this
 *  feedback". Codex 0.158.0 also draws one with no "to", "enter continue · esc
 *  quit" under its folder trust prompt (codex-0158-screens.test.ts). That shape
 *  counts only as a whole row of two or more "<key> <word>" pairs, so a
 *  sentence that starts with "Enter" is still no hint. */
const HINT = new RegExp(
  String.raw`^\s*(?:(?:press\s+)?${HINT_KEY}\s+to\s\S|${HINT_KEY}\s+[a-z]+(?:\s+·\s+${HINT_KEY}\s+[a-z]+)+\s*$)`,
  'i'
)
const RULE = /^\s*[─━═]+…?\s*$/
/** Claude's own input row, at column 0 (COMPOSER_ROW in
 *  mobile-terminal-sent-prompts.ts): `❯` then a no-break space (2.1.270 and
 *  later), or a bare `❯` once a reader trims that space. A sent prompt takes a
 *  plain one. Anchored: a final check (2026-09-27) found an unanchored rule
 *  cleared a live dialog over any indented `❯` in tool output, a heredoc or a
 *  plan. */
const CLAUDE_INPUT = /^❯(?:\u00a0|\s*$)/
/** Codex's own input row: `› ` at column 0. Under a menu it can only be the
 *  input, since the menu's options all sit above. */
const CODEX_INPUT = /^› /

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
 * Verified against every capture under fixtures/ and the 2.1.276, 2026-09-05,
 * Codex 0.153.4 and Codex 0.158.0 (folder trust prompt) captures in
 * mobile-native-chat-dialog-guard.test.ts.
 */
export function terminalDialogKind(
  lines: readonly string[],
  /** The tab's agent. Claude's input-row rule is Claude's only. */
  agent?: string | null
): TerminalDialogKind | null {
  if (agent !== 'codex' && lines.some((row) => CLAUDE_INPUT.test(row))) {
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
  // next blank row, rule or Codex input row.
  const hints: string[] = []
  let inHint = false
  let underIsItsOwn = true
  for (let at = last.index + 1; at < lines.length; at++) {
    const row = lines[at]!
    if (blankOrRule(row)) {
      inHint = false
    } else if (CODEX_INPUT.test(row)) {
      inHint = underIsItsOwn = false
    } else if (HINT.test(row)) {
      hints.push(row)
      inHint = true
    } else if (!inHint && indentOf(row) <= last.column) {
      underIsItsOwn = false
    }
  }
  const hinted = hints.length > 0
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
  // Typing on the plan review's feedback row replaces that label in place
  // (claude-plan-feedback-send.ts, fact 4), so its second choice names it too.
  const planReview = labels.some(
    (label) => isClaudePlanFeedbackOptionLabel(label) || /^Yes, manually approve edits\b/i.test(label)
  )
  if (!planReview) {
    const question = lines.slice(0, options[0]!.index).findLast((row) => row.trim())
    if (!underIsItsOwn || (!hinted && !(question !== undefined && /\?\s*$/.test(question)))) {
      return null
    }
  }
  // An ask ("Enter to select · …") is a menu whatever its options say.
  const ask = hints.some((hint) => /^\s*Enter to select\b/i.test(hint))
  const yesNo = labels.some((label) => /^yes\b/i.test(label)) && labels.some((label) => /^no\b/i.test(label))
  return planReview || (yesNo && !ask) ? 'approval' : 'menu'
}

export function terminalDialogOnScreen(lines: readonly string[], agent?: string | null): boolean {
  return terminalDialogKind(lines, agent) !== null
}

/** The agents whose composer the phone can locate on a screen, so a send to one
 *  that shows none (a shell, a dialog) can be refused. Codex's `›` row alone is
 *  also a sent prompt, a popup row and an approval option; what is under it (nothing at
 *  column 0, no dialog key hint) is what codexComposerLive reads. */
const composerLocated = (agent: string | null | undefined): boolean =>
  agent === 'claude' || agent === 'codex'

/**
 * Why a write from the chat must not go now, or null. Read fresh, not from the
 * chat's last poll, which can be seconds old.
 *
 * `requireComposer` is for a write that types words into the agent's input and
 * presses Enter (a composer send, a photo paste, an answer, a picked command).
 * After the dialog check, which keeps its place and its own message, it refuses
 * a screen that is a screen (`source: 'screen'`, said outright) and does not show
 * the agent's input box (Claude's, or Codex's): a shell the agent exited to, transcript mode, `!` bash
 * mode (what is typed there runs as a command, so it is refused too). The tab
 * still says `claude` for about 30 minutes after the process is gone (a
 * hand-started agent's type outlives it), so the tab is no evidence.
 *
 * A screen that cannot be had is told apart by what the host said (Orca 1.4.218
 * puts `source` on every reply to a screen request; the host-screen-answers.ts
 * comment has the history):
 *  - `source: 'screen-unavailable'`: the host can read screens and has none to
 *    show. Read again for about 1.5 s, then refuse (SEND_SCREEN_UNAVAILABLE_REFUSAL).
 *  - a rejection or a reply that is no screen: the same, ONLY on a host that has
 *    answered a screen on this connection.
 *  - a timeout, or a link that is down or re-dialing: wait for the link inside the
 *    send's budget (less what its writes need) and read again, refusing
 *    (SEND_SCREEN_UNREADABLE_REFUSAL) only when that has run out, and only on a host
 *    that has answered a screen on this connection. On any other host (nothing
 *    answered yet) it fails open, as every send did before this look existed.
 *    (mobile-native-chat-screen-look.ts has the timings.)
 *  - a reply with no `source`, or a stream tail: an older host, which cannot
 *    show a screen. Fails open for the same reason: refusing every send to it
 *    would be the worse bug.
 * Codex gets the same looks with its own proof (codexComposerLive); every other
 * agent is unchanged (composerLocated).
 */
export async function readSendUnderDialogRefusal(args: {
  client: Parameters<typeof terminalScreenLinesRead.request>[0]
  terminal: string
  /** The tab's agent, for the rules that are one agent's only. */
  agent?: string | null
  /** The action's own budget, when it has one; the look never takes longer. */
  deadline?: number
  /** The write types into the agent's input (Claude's or Codex's): also refuse a
   *  screen that shows no box, and a screen that cannot be had. */
  requireComposer?: boolean
}): Promise<string | null> {
  const wantsBox = args.requireComposer === true && composerLocated(args.agent)
  const seen = await lookAtScreen(args, wantsBox)
  if (seen.kind === 'unavailable') {
    return wantsBox ? SEND_SCREEN_UNAVAILABLE_REFUSAL : null
  }
  if (seen.kind === 'rejected' || seen.kind === 'unreachable') {
    return wantsBox && seen.hostAnswers ? SEND_SCREEN_UNREADABLE_REFUSAL : null
  }
  if (terminalDialogOnScreen(seen.lines, args.agent)) {
    return SEND_UNDER_DIALOG_REFUSAL
  }
  if (!wantsBox || !replyIsScreen(seen.reply)) {
    return null
  }
  const codex = args.agent === 'codex'
  const live = codex ? codexComposerLive : claudeComposerLive
  // A read can catch the agent between erasing its bottom area and drawing it again: with
  // background agents Claude repaints it every second, and one such read refused a live box
  // (2026-10-11, Claude Code 2.1.296). A shell or transcript mode stays; a repaint does not.
  let lines = seen.lines
  let looks = 1
  const budgetEnd = (args.deadline ?? Date.now() + 15_000) - MOBILE_NATIVE_CHAT_SEND_WRITE_RESERVE_MS
  while (!live(lines) && looks < BOX_LOOKS && Date.now() + BOX_RELOOK_PAUSE_MS < budgetEnd) {
    await new Promise((resolve) => setTimeout(resolve, BOX_RELOOK_PAUSE_MS))
    const again = await lookAtScreen({ ...args, deadline: budgetEnd + MOBILE_NATIVE_CHAT_SEND_WRITE_RESERVE_MS }, false)
    looks += 1
    if (again.kind !== 'read' || !replyIsScreen(again.reply)) {
      break
    }
    if (terminalDialogOnScreen(again.lines, args.agent)) {
      return SEND_UNDER_DIALOG_REFUSAL
    }
    lines = again.lines
  }
  if (live(lines)) {
    return null
  }
  // The one line a refusal leaves behind says what the screen showed (no words of it).
  console.warn(`[send-look] no ${codex ? 'codex' : 'claude'} input box after ${looks} looks: ${describeScreenForLog(lines)}`)
  return codex ? SEND_WITHOUT_CODEX_COMPOSER_REFUSAL : SEND_WITHOUT_COMPOSER_REFUSAL
}

/** How many reads a send gives a screen that shows no input box before it refuses. */
const BOX_LOOKS = 3
const BOX_RELOOK_PAUSE_MS = 400

/**
 * The shape of a screen with no input box, for the log: how many rows, where the input rows and
 * rules are, and the rows at column 0 under the last rule. Glyphs and lengths only, never the
 * words on screen (they are the user's conversation).
 */
export function describeScreenForLog(lines: readonly string[]): string {
  const inputRows = lines.flatMap((row, index) => (/^[❯›!](?:\s|$)/.test(row) ? [index] : []))
  const rules = lines.flatMap((row, index) => (/[─━]{3}/.test(row) ? [index] : []))
  const lastRule = rules.at(-1) ?? -1
  const unindented = lines
    .slice(lastRule + 1)
    .flatMap((row, offset) => (row.trim() !== '' && !row.startsWith('  ') ? [`${lastRule + 1 + offset}:${JSON.stringify(row.slice(0, 2))}/${row.length}`] : []))
  const tail = lines.slice(-6).map((row) => (row.trim() === '' ? '_' : `${JSON.stringify(row.trimStart().slice(0, 1))}${row.length - row.trimStart().length}/${row.length}`))
  return `${lines.length} rows; input rows [${inputRows.join(',')}]; rules [${rules.join(',')}]; column-0 rows under the last rule [${unindented.join(' ')}]; last rows ${tail.join(' ')}`
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
