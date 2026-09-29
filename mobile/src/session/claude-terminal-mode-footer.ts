export type TerminalPermissionMode =
  | 'default'
  | 'manual'
  | 'acceptEdits'
  | 'plan'
  | 'auto'
  | 'bypassPermissions'

/**
 * Claude Code's mode footer as captured: the phrase opens the row after its
 * glyph and is followed by the hint, a "·" item, or nothing.
 *
 *   "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents"   2.1.281, 2.1.282
 *   "  ⏵⏵ auto mode on (shift+tab to cycle)"                  2.1.281
 *   "  ⏵⏵ auto mode on · 1 shell · ← for agents"              2.1.277
 *   "▶▶ auto mode on · 4 shells · ← for agents"               a screen on 2026-09-14
 *   "  ⏸ manual mode on · ← for agents"                       2.1.270, 2.1.276
 *   "  ⏵⏵ accept edits on (shift+tab to cycle)"               2026-09-18
 *   "  ⏵⏵ bypass permissions on (shift+tab to  ·"             2.1.278 at 46 columns
 *
 * The last one is why the hint is matched by its first word: at a narrow width
 * Claude Code drops the hint's words from the end.
 *
 * Why the shape: the phrases were matched anywhere on any row, so while a
 * dialog or a repaint hid the footer, a line of conversation ("I would not use
 * bypass permissions on prod.") set the pill, and the mode stepper acted on it
 * (review, 2026-09-30). Plan mode has no captured footer on record, so its
 * phrase is held to the bottom rows only, as every phrase is.
 */
function footerMode(phrase: string): RegExp {
  return new RegExp(`^\\s*(?:[⏵⏸▶]+\\s*)?${phrase}(?=\\s*$|\\s+·|\\s+\\(shift)`, 'i')
}

/** The modes whose footer row has been captured, in that row's shape. */
const FOOTER_MODE_PATTERNS: Array<[RegExp, TerminalPermissionMode]> = [
  [footerMode('manual mode on'), 'manual'],
  [footerMode('accept edits on'), 'acceptEdits'],
  [footerMode('auto mode on'), 'auto'],
  [footerMode('bypass permissions on'), 'bypassPermissions']
]
const PERMISSION_MODE_PATTERNS: Array<[RegExp, TerminalPermissionMode]> = [
  ...FOOTER_MODE_PATTERNS,
  [/plan mode on/i, 'plan']
]

/** How far up from the last painted row the footer can sit. Every capture
 *  draws it last; the status line, when there is one, sits above it. */
const FOOTER_ROWS = 6

/** The bottom rows that have anything on them. A screen can end in blank rows
 *  under what is drawn (the 2.1.282 capture's question screen ends in 21). */
function claudeFooterRows(lines: readonly string[]): readonly string[] {
  let end = lines.length
  while (end > 0 && (lines[end - 1] ?? '').trim() === '') {
    end -= 1
  }
  return lines.slice(Math.max(0, end - FOOTER_ROWS), end)
}

/** Whether one of the captured footer rows is at the bottom of this screen.
 *  Plan mode's bare phrase does not count: nothing on record says it is the
 *  footer and not conversation. */
export function hasClaudeModeFooter(lines: readonly string[]): boolean {
  return claudeFooterRows(lines).some((row) =>
    FOOTER_MODE_PATTERNS.some(([pattern]) => pattern.test(row))
  )
}

/** The mode the footer states, or null when no footer row is on this screen.
 *
 *  Null is a real answer and callers must keep it. `parseTerminalPermissionMode`
 *  collapses it to 'default' for the HUD, which reads as Manual — fine for a
 *  pill that shows the last known mode, wrong for anything that ACTS on it. The
 *  mode stepper treated a blank mid-repaint frame as "already Manual" and
 *  reported success having pressed nothing, so the pill claimed Manual while the
 *  agent kept auto-accepting edits (2026-09-14). */
export function readTerminalPermissionMode(
  lines: readonly string[]
): TerminalPermissionMode | null {
  const rows = claudeFooterRows(lines)
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index] ?? ''
    for (const [pattern, mode] of PERMISSION_MODE_PATTERNS) {
      if (pattern.test(row)) {
        return mode
      }
    }
  }
  return null
}
