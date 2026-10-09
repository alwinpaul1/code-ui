// Which screen rows may state a context figure or a status-line badge, for the two agents' own
// paintings.
//
// On a tab with no status line and no beacon the screen is the only source of the ring, and the
// readers took a figure from any row near the bottom: Claude's answer "You are at about 45% context
// right now" set a 45% ring, and Codex's "It says 62% context left" a 38% one (review, 2026-09-30;
// context-ring-read-off-an-answer.test.ts). An answer can say anything, so a figure counts only where
// the agent itself paints one.

/** Claude Code's input row: `❯` at column 0, then its no-break space (2.1.270 and later), a plain
 *  one, or nothing once a reader trims the row (mobile-native-chat-dialog-guard.ts CLAUDE_INPUT). */
const CLAUDE_INPUT_ROW = /^❯(?: |\s|$)/
const CLAUDE_BOX_RULE = /^\s*─+\s*$/
/** Codex's composer row (codex-terminal-queued-messages.ts CODEX_COMPOSER_ROW). */
const CODEX_COMPOSER_ROW = /^\s*›\s/

/** The first row under Claude Code's input box, where it paints its status line and mode footer:
 *  the row after the rule that closes the last input row. -1 when no box is on screen. */
export function claudeRowsUnderInputBox(lines: readonly string[]): number {
  const input = lines.findLastIndex((row) => CLAUDE_INPUT_ROW.test(row))
  if (input === -1) {
    return -1
  }
  const rule = lines.findIndex((row, index) => index > input && CLAUDE_BOX_RULE.test(row))
  return rule === -1 ? -1 : rule + 1
}

/** The first row under the agent's own input row, where a status line and its footer are painted:
 *  under Claude Code's input box when one is on screen, else under Codex's composer (Codex paints
 *  no badge). A status-line badge and the footer's shell count are read from here down. A
 *  "[Sonnet 4.6 high | Max 20x] ctx 54%" row in a tool's output above the box set the pill and the
 *  ring (review, 2026-09-30; status-line-badge-in-tool-output.test.ts), and an answer quoting
 *  "· 4 shells" the shell count (shell-count-read-off-an-answer.test.ts). A box whose top rule and
 *  input row are on screen and whose closing rule is not has nothing under it on screen. With
 *  neither agent's input row on screen, 0: every row is still read, as before, since no capture
 *  shows a live status line without its box, and fixtures pin a badge beside a bare `❯` or on a
 *  screen of its own. */
export function rowsUnderAgentInput(lines: readonly string[]): number {
  const input = lines.findLastIndex((row) => CLAUDE_INPUT_ROW.test(row))
  if (input !== -1) {
    const under = claudeRowsUnderInputBox(lines)
    if (under !== -1) {
      return under
    }
    if (CLAUDE_BOX_RULE.test(lines[input - 1] ?? '')) {
      return lines.length
    }
  }
  const composer = lines.findLastIndex((row) => CODEX_COMPOSER_ROW.test(row))
  return composer + 1
}

/** Claude Code's FULLSCREEN notice row: the first non-empty row above the input box's top rule, drawn
 *  right-aligned and flush with the box's right edge two columns in (the footer's `paddingX: 2`).
 *  Claude Code 2.1.295 paints its own "Context low (N% remaining)" and "N% until auto-compact" there,
 *  as it does the effort hint and the alt+p toast (claude-screen-model-statement.ts); the default
 *  layout paints them on the footer row instead. A reply row opens two columns in and is not flush,
 *  so it is never this row (claude-fullscreen-context-warning.test.ts). -1 when there is none. */
export function claudeFullscreenNoticeRow(lines: readonly string[]): number {
  const input = lines.findLastIndex((row) => CLAUDE_INPUT_ROW.test(row))
  const top = input - 1
  if (top < 0 || !CLAUDE_BOX_RULE.test(lines[top] ?? '')) {
    return -1
  }
  const edge = Array.from(lines[top]!.trimEnd()).length - 2
  let above = top - 1
  while (above >= 0 && lines[above]!.trim() === '') {
    above -= 1
  }
  if (above < 0) {
    return -1
  }
  const row = lines[above]!.trimEnd()
  return /^ {3}/.test(row) && Array.from(row).length === edge ? above : -1
}

/** Claude Code's own turn row, the lowest thing it paints in the conversation: the spinner while it
 *  works ("✻ Incubating… (4s · ↓ 325 tokens)") and the turn-end row after ("✻ Crunched for 5s · done
 *  12:54 PM"), both at column 0 (2.1.295 captures, claude-status-line-context.test.ts). */
const CLAUDE_TURN_ROW = new RegExp(
  String.raw`^[✳✻✽✶✢·*]\s+\p{Lu}[\p{L}'’\-]+(?:…|\s+for\s+\d)`,
  'u'
)
/** Rows between the turn row and the box that Claude Code itself paints there, never a status
 *  line's: the spinner's `⎿  Tip:` row, a queued or typed prompt, an answer. */
const CLAUDE_OWN_ROW_UNDER_TURN = /^\s*[⎿❯⏺]/
/** A continuation under one of those rows (a todo list's later items, a wrapped tip) is indented
 *  four or more columns; a status line's own rows are drawn two or three in (2.1.295 captures). */
const CLAUDE_CONTINUATION_ROW = /^ {4,}\S/
/** Claude Code's own menus under the box: the slash-command and `@` file pickers, highlighted row
 *  included. Their descriptions are anyone's text (review, 2026-10-09). */
const CLAUDE_MENU_ROW = /^\s*(?:❯\s*)?[/@]/

/** A row a Powerline-style painter draws: one column in (usage-band's `paddingX: 1`) or none, then a
 *  pill cap or icon from the private-use block U+E0A0-U+E0D7 (usage-band opens every pill with
 *  U+E0B6; Orca screen reads of Claude Code 2.1.295, claude-usage-band-fullscreen-126-*.txt). Claude
 *  Code draws its conversation two columns in at least (the `⏺ ` gutter, `⎿` rows deeper), so a reply
 *  cannot put a row here, whatever text it prints. */
const PAINTED_PILL_ROW = /^ ?[-]/
/** The `[-]` toggle drawn alone and right-aligned above the slot a mod paints into over the box
 *  (every 2.1.294 and 2.1.295 capture of the usage-band layout). */
const SLOT_TOGGLE_ROW = /^\s+\[[-+]\]\s*$/

/** The rows a user's own status-line painting may sit on, as indices, around Claude Code's input
 *  box: every row under the box (where Claude Code draws a status line), and rows above the box's
 *  top rule (where a mod such as usage-band draws its band; 2.1.295 captures), in one of two ways:
 *  - Claude Code's own spinner or turn-end row in reach: every row between it and the box, except
 *    the rows Claude Code paints there itself (`⎿`, a todo list's continuations) and its fullscreen
 *    notice slot. The conversation sits above the turn row.
 *  - No turn row in reach (an agent's `⏺ Agent "…" finished` notice right above the band, a resumed
 *    or cleared screen): only the painted pill rows (PAINTED_PILL_ROW) of the unbroken block directly
 *    above the rule, which may also hold blank rows, the `[-]` toggle and the notice slot. The block
 *    ends at the first other row. An answer's continuation row ("  Opus 5.5 high │ ◔ 12% 120.0k/1.0M")
 *    has the band's text but sits two columns in with no pill cap, so it ends the block unread. A
 *    painter that draws without the caps (the 2.1.294 captures) is read only under a turn row. Until
 *    2026-10-09 nothing above the box was read without a turn row, and a 126-column tab whose lowest
 *    conversation row was an agent's finished notice had no ring and no effort (Orca screen read).
 *  Claude Code's menus under the box are skipped. Empty with no box on screen. `width` is the box's,
 *  which is the pane's: a row that fills it may have wrapped. */
export function claudeStatusLineRows(lines: readonly string[]): { rows: number[]; width: number } {
  const input = lines.findLastIndex((row) => CLAUDE_INPUT_ROW.test(row))
  const top = input - 1
  if (top < 0 || !CLAUDE_BOX_RULE.test(lines[top] ?? '')) {
    return { rows: [], width: 0 }
  }
  const width = Array.from(lines[top]!.trimEnd()).length
  const under = claudeRowsUnderInputBox(lines)
  const rows: number[] = []
  if (under !== -1) {
    for (let index = under; index < lines.length; index += 1) {
      if (!CLAUDE_MENU_ROW.test(lines[index] ?? '')) {
        rows.push(index)
      }
    }
  }
  const notice = claudeFullscreenNoticeRow(lines)
  const turn = claudeTurnRowAbove(lines, top)
  const above: number[] = []
  for (let index = top - 1; index > turn; index -= 1) {
    const row = lines[index] ?? ''
    if (turn === -1) {
      if (PAINTED_PILL_ROW.test(row)) {
        above.push(index)
      } else if (row.trim() !== '' && !SLOT_TOGGLE_ROW.test(row) && index !== notice) {
        break
      }
      continue
    }
    // Claude Code's own fullscreen notice slot, where only its wording is read
    // (claude-fullscreen-context-warning.test.ts); a status line never paints flush with the box.
    if (!CLAUDE_OWN_ROW_UNDER_TURN.test(row) && !CLAUDE_CONTINUATION_ROW.test(row) && index !== notice) {
      above.push(index)
    }
  }
  return { rows: [...above, ...rows], width }
}

/** Claude Code's spinner or turn-end row above the box's top rule, reached through indented rows
 *  only; -1 when a column-0 row (an answer, a prompt, a notice) or the top of the screen comes first. */
function claudeTurnRowAbove(lines: readonly string[], top: number): number {
  for (let index = top - 1; index >= 0; index -= 1) {
    const row = lines[index] ?? ''
    if (CLAUDE_TURN_ROW.test(row)) {
      return index
    }
    if (/^\S/.test(row)) {
      return -1
    }
  }
  return -1
}

/** Claude Code's input box rule: a row of `─` alone. */
export function isClaudeBoxRule(row: string): boolean {
  return CLAUDE_BOX_RULE.test(row)
}

/** A row of Claude's conversation rather than its own painting: an answer (`⏺`), and, above an input
 *  box on screen, any indented row (an answer's continuation or a tool's output). With no box on
 *  screen the footer rows themselves are indented, so only an answer row is known for one. */
export function isClaudeConversationRow(row: string, boxOnScreen: boolean): boolean {
  return /^\s*⏺/.test(row) || (boxOnScreen && /^\s/.test(row))
}

/** The transient figure codex-cli 0.153.4 paints right-aligned on a row of its own, directly above
 *  the composer, after `/status` ("100% context left"; mobile-terminal-hud-parse.test.ts). */
const CODEX_FIGURE_ALONE = /^(\s*)((?:\d{1,3}%\s+context\s+left|Context\s+\d{1,3}%\s+left))\s*$/

/** Right-aligned, as Codex paints it: at least as much space before the figure as the figure is
 *  long. An answer's last row ("  62% context left", two spaces in) is not; a pane too narrow for
 *  that loses the figure, which is a refusal, not a wrong ring. */
function isRightAlignedFigure(row: string): boolean {
  const match = CODEX_FIGURE_ALONE.exec(row)
  return match !== null && match[1]!.length >= match[2]!.length
}

/** The rows Codex paints a footer figure on, bottom first: its footer row ("<model> <effort> · <cwd>",
 *  which carries the figure on its right or as the `context-remaining` status-line item) and the rows
 *  under it, within the last four rows as hasCodexFooter reads the footer; and a row holding the
 *  figure alone, right-aligned, directly above the composer. Never an answer row. */
export function codexFooterFigureRows(
  lines: readonly string[],
  isFooterRow: (row: string) => boolean
): string[] {
  const rows: string[] = []
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - 4); index -= 1) {
    if (isFooterRow(lines[index] ?? '')) {
      rows.push(...lines.slice(index).toReversed())
      break
    }
  }
  const composer = lines.findLastIndex((row) => CODEX_COMPOSER_ROW.test(row))
  const above = composer > 0 ? (lines[composer - 1] ?? '') : ''
  if (isRightAlignedFigure(above)) {
    rows.push(above)
  }
  return rows
}

/** A row of Codex's `/status` box with its frame intact: `│` at column 0 and at the row's end. A row
 *  an answer quotes is indented, and a cut one has lost its right edge. */
export const CODEX_STATUS_BOX_ROW = /^│.*│\s*$/
