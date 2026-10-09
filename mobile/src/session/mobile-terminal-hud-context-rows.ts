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
