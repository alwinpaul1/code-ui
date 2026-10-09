// The context figure a user's OWN status-line painting shows, read off the screen of a Claude tab.
//
// A `claude` typed by hand has no beacon, so before this the screen gave it a ring only from a
// claude-hud style badge or from Claude Code's own low-context warning. Many status lines print the
// tokens in context against the window, `68.3k/1.0M`, and that is the session stating both halves of
// the fraction itself. The user approved reading it on 2026-10-09, overriding the earlier rule that
// the usage-band rows were not to be read (docs/mobile-agent-hud.md, "The user's own status-line
// figure").
//
// Read only where a status-line painting sits (claudeStatusLineRows): under the input box, and above
// it between Claude Code's own turn row and the box's top rule. Refused whenever it is not one
// unambiguous figure: two figures, a percent beside it that disagrees with it or is labelled as a
// rate-limit window, a row cut by the painter or wrapped by the pane. The window is the one the row
// states; nothing here derives one.

import { claudeStatusLineRows, isClaudeBoxRule } from './mobile-terminal-hud-context-rows'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

/** `<used>/<window>`: the window always carries a k or M suffix (a date, a fraction or a ratio does
 *  not), the used figure may be bare. Bounded by a space, the row's edge, a bracket or a separator on
 *  both sides, so `68.3k/1.0M…` (cut) and `$1.2k/$5k` (cost) are not figures. */
const FIGURE =
  /(?<=^|[\s([│|·])(\d+(?:\.\d+)?[kKmM]?)\s*\/\s*(\d+(?:\.\d+)?[kKmM])(?=$|[\s)\]│|·,])/g
/** A percent directly before the figure: `7% 68.3k/1.0M`, `27% (54.2k/200k)`. */
const PERCENT_BEFORE = /(\d{1,3})%\s{0,2}\(?\s?$/
/** A percent directly after it: `54.2k/200k (27%)`, `68.3k/1.0M 7%`. */
const PERCENT_AFTER = /^\s?\)?\s{0,2}\(?\s?(\d{1,3})%/
/** What labels a percent or figure as a usage window or a cost rather than the context. */
const RATE_OR_COST = /\$|\b\d+\s*[hdw]\b|\b(?:session|week(?:ly)?|daily|hourly|limit|cost|quota)\b/i
/** A segment of a status line ends at a separator or a wide gap. */
const SEGMENT_BREAK = /[│|]|\s{3,}/g

type Figure = { used: string; window: string; before: string | null; after: string | null; label: string }

function tokens(label: string): { value: number; half: number } {
  const suffix = label.at(-1)?.toLowerCase()
  const scale = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1
  const digits = suffix === 'm' || suffix === 'k' ? label.slice(0, -1) : label
  const decimals = digits.includes('.') ? digits.length - digits.indexOf('.') - 1 : 0
  return { value: Number(digits) * scale, half: 0.5 * 10 ** -decimals * scale }
}

/** The text of the figure's own segment before it, back to the previous separator or wide gap. */
function segmentBefore(row: string, at: number): string {
  const before = row.slice(0, at)
  let start = 0
  for (const match of before.matchAll(SEGMENT_BREAK)) {
    start = match.index + match[0].length
  }
  return before.slice(start)
}

function figuresOn(row: string): Figure[] | null {
  const figures: Figure[] = []
  for (const match of row.matchAll(FIGURE)) {
    const prefix = segmentBefore(row, match.index)
    const before = PERCENT_BEFORE.exec(prefix)
    if (RATE_OR_COST.test(prefix)) {
      // A figure in a segment labelled as a usage window or a cost is not the context. Refuse the
      // whole read: the row states something this reader cannot place.
      return null
    }
    const after = PERCENT_AFTER.exec(row.slice(match.index + match[0].length))
    figures.push({
      used: match[1]!,
      window: match[2]!,
      before: before?.[1] ?? null,
      after: after?.[1] ?? null,
      label: match[0]
    })
  }
  return figures
}

/** The percent the figure states, cross-checked against the painted percents beside it, or null when
 *  a painted percent disagrees or the figure is not a fraction of its window. */
function checkedPercent(figure: Figure): number | null {
  const used = tokens(figure.used)
  const window = tokens(figure.window)
  if (!(window.value > 0) || !(used.value >= 0) || used.value > window.value) {
    return null
  }
  const low = (Math.max(0, used.value - used.half) / (window.value + window.half)) * 100
  const high = ((used.value + used.half) / Math.max(1, window.value - window.half)) * 100
  const painted = [figure.before, figure.after].filter((value) => value !== null).map(Number)
  for (const percent of painted) {
    // One point either side for the painter's own rounding (round or floor).
    if (percent > 100 || percent < low - 1 || percent > high + 1) {
      return null
    }
  }
  return painted[0] ?? Math.round((used.value / window.value) * 100)
}

/** The ring from a `<used>/<window>` figure the user's own status-line painting shows, or null. */
export function readClaudeStatusLineContext(lines: readonly string[]): TerminalHudContextWindow | null {
  const { rows, width } = claudeStatusLineRows(lines)
  if (rows.length === 0) {
    return null
  }
  const found: { figure: Figure; index: number }[] = []
  for (const index of rows) {
    const figures = figuresOn(lines[index] ?? '')
    if (figures === null) {
      return null
    }
    found.push(...figures.map((figure) => ({ figure, index })))
  }
  if (found.length !== 1) {
    return null
  }
  const { figure, index } = found[0]!
  // A row that fills the pane may be wrapped onto the next, and one after a full row may be the
  // tail of it: the figure may then be cut in two.
  const fills = (row: string | undefined) =>
    row !== undefined && !isClaudeBoxRule(row) && Array.from(row.trimEnd()).length >= width
  if (fills(lines[index]) || fills(lines[index - 1])) {
    return null
  }
  const usedPercent = checkedPercent(figure)
  if (usedPercent === null) {
    return null
  }
  return { usedPercent, usedLabel: figure.used, windowLabel: figure.window }
}
