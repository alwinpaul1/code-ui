import { isPromptRule, QUEUE_HINT, SELECTED_HINT } from './mobile-terminal-queue-block'

/**
 * Claude Code's input box as the phone reads it off `terminal.read --screen`:
 * the `❯` row and its wrapped rows between the composer's two rules.
 *
 * Shapes, Claude Code 2.1.287 (Orca history log of the 2026-10-01 incident,
 * words replaced by stand-ins of the same length; fixtures/claude-composer-
 * 2.1.287.ts): a rule, the `❯` row (`❯` and a no-break space), the rows it wraps
 * onto at a two-column indent, a rule. Orca drops blank rows. A named rule
 * (2.1.285) has a label in it. The review notice sits above the top rule.
 *
 * Two ways the text reaches the phone, both real. Where Orca's composer
 * detector accepts the row above `❯` (a bare rule), Orca takes the text out of
 * `tail`, leaving a bare `❯`, and publishes it as `draft`
 * (mobile-terminal-queue-block.ts withComposerText). Under a named rule it
 * declines: `draft` is '' and the text stays in the rows. So the input is empty
 * only when BOTH are empty.
 */
export type ClaudeInputRead =
  /** No composer between two rules: a dialog in its place, a cut screen. Says
   *  nothing about the input, and nothing is guessed from it. */
  | { located: false }
  | {
      located: true
      /** The input's text, '' when it is empty. A placeholder is not text. */
      text: string
      /** Rows the input takes, at least 1. The larger of the rows drawn and the
       *  rows `draft` would take at the screen's width. */
      rows: number
    }

const INPUT_ROW = /^❯(?: |\s|$)/
const MENU_ROW = /^❯\s+\d+[.)]\s/
/** What Claude draws in an empty input: the queue hints (QUEUE_HINT and
 *  SELECTED_HINT, every wording the 2.1.287 binary holds) and its example
 *  prompt. Dim on the desktop, so the screen cannot tell it from typed text. */
const PLACEHOLDER = /^(?:Press (?:up|Enter) to\b|Try ")/i
/** The narrowest terminal Claude draws a rule across; below it a rule is a
 *  scrap of dashes and says nothing about the width. */
const MIN_RULE_COLUMNS = 20

const isRule = (line: string): boolean => /[─━]{3}/.test(line) && isPromptRule(line)

const isPlaceholder = (text: string): boolean =>
  PLACEHOLDER.test(text) || QUEUE_HINT.test(text) || SELECTED_HINT.test(text)

function rowsFor(text: string, columns: number): number {
  return text
    .split(/\r\n|\r|\n/)
    .reduce((rows, line) => rows + Math.max(1, Math.ceil(Array.from(line).length / columns)), 0)
}

/**
 * What the input holds, from a screen read: `tail` rows and Orca's `draft`.
 * The composer is the last `❯` row with a rule directly above it and another
 * rule below it (the box's two rules), so a sent prompt's `❯` row in the
 * conversation, a menu's `❯ 1.` row and a quoted `❯` are never taken for it.
 */
export function readClaudeInput(lines: readonly string[], draft: string): ClaudeInputRead {
  for (let at = lines.length - 1; at >= 1; at--) {
    const row = lines[at]!
    if (!INPUT_ROW.test(row) || MENU_ROW.test(row) || !isRule(lines[at - 1]!)) {
      continue
    }
    const bottom = lines.findIndex((line, index) => index > at && isRule(line))
    if (bottom === -1) {
      continue
    }
    const drawn = [row.replace(/^❯[  ]?/, ''), ...lines.slice(at + 1, bottom)]
      .map((part) => part.trim())
      .filter((part) => part !== '')
    const tailText = isPlaceholder(drawn.join(' ')) ? '' : drawn.join('\n')
    const draftText = isPlaceholder(draft.trim()) ? '' : draft.trim()
    const text = draftText.length >= tailText.length ? draftText : tailText
    const ruleWidth = Array.from(lines[at - 1]!.trimEnd()).length
    const columns = Math.max(MIN_RULE_COLUMNS, ruleWidth) - 2
    return {
      located: true,
      text,
      rows: text === '' ? 1 : Math.max(1 + (bottom - at - 1), rowsFor(draftText, columns), 1)
    }
  }
  return { located: false }
}

/** The review notice Claude Code 2.1.287 draws when a submit held characters it
 *  strips (`txe`: `${i} · review and press ${r} to send`). The key name is a
 *  parameter there, so it is not pinned to "Enter". Anchored to a whole row, and
 *  only in the rows directly above the composer, so a message that quotes it
 *  in the conversation is not mistaken for it. */
const NOTICE =
  /^\s*(Removed \d+ invisible characters? · review and press \S+ to send)\s*$/

export function claudeSubmitNotice(lines: readonly string[]): string | null {
  for (let at = lines.length - 1; at >= 1; at--) {
    if (!INPUT_ROW.test(lines[at]!) || MENU_ROW.test(lines[at]!) || !isRule(lines[at - 1]!)) {
      continue
    }
    for (let above = at - 2; above >= Math.max(0, at - 5); above--) {
      const match = NOTICE.exec(lines[above]!)
      if (match) {
        return match[1]!
      }
    }
    return null
  }
  return null
}
