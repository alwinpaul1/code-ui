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
// it between Claude Code's own turn row and the box's top rule, or with no turn row in reach, on the
// painted pill rows of the block directly on the rule. Refused whenever it is not one unambiguous
// figure: two figures, a percent beside it that disagrees with it or is labelled as a rate-limit
// window, a row cut by the painter or wrapped by the pane, a subagent's pill on screen. The window is
// the one the row states; nothing here derives one.
//
// The model and effort the same row opens with (`Opus 5.5 xhigh │`) are read too since the user
// approved it later on 2026-10-09 (readClaudeStatusLineModel).

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
/** What labels a percent or figure as a usage window or a cost rather than the context, on either
 *  side of it in its segment (review, 2026-10-09: "5-hour 120k/500k", "120k/500k tokens today",
 *  claude-hud's "Usage … (55k/500k) (resets …)"). */
const RATE_OR_COST =
  /\$|\b\d+\s*-?\s*(?:[hdw]|hours?|days?|weeks?)\b|\b(?:session|week(?:ly)?|wk|daily|hourly|today|limit|cost|quota|usage|resets?|block|plan)\b/i
/** A segment of a status line ends at a separator, a wide gap, or a Powerline pill cap (the
 *  private-use glyphs U+E0A0-U+E0D7; usage-band draws its pills with U+E0B4/U+E0B6, so the 5h pill
 *  starts two columns after the context figure, 2.1.295 capture). */
const SEGMENT_BREAK = /[│|\uE0A0-\uE0D7]|\s{3,}/g

type Figure = { used: string; window: string; before: string | null; after: string | null; label: string }

function tokens(label: string): { value: number; half: number } {
  const suffix = label.at(-1)?.toLowerCase()
  const scale = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1
  const digits = suffix === 'm' || suffix === 'k' ? label.slice(0, -1) : label
  const decimals = digits.includes('.') ? digits.length - digits.indexOf('.') - 1 : 0
  return { value: Number(digits) * scale, half: 0.5 * 10 ** -decimals * scale }
}

/** The text of the figure's own segment after it, up to the next separator or wide gap. */
function segmentAfter(row: string, from: number): string {
  const after = row.slice(from)
  SEGMENT_BREAK.lastIndex = 0
  const next = after.search(SEGMENT_BREAK)
  return next === -1 ? after : after.slice(0, next)
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
    if (RATE_OR_COST.test(prefix) || RATE_OR_COST.test(segmentAfter(row, match.index + match[0].length))) {
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

/** What the status-line rows say about the context: a figure, nothing, or a refusal (a figure is
 *  there and cannot be placed). A refusal also stops the older under-box patterns reading the same
 *  row ("Usage … 11% (55k/500k) (resets …)" is claude-hud's shape; review, 2026-10-09). */
export type ClaudeStatusLineContextRead =
  | { kind: 'figure'; context: TerminalHudContextWindow }
  | { kind: 'none' }
  | { kind: 'refused' }

/** The ring from a `<used>/<window>` figure the user's own status-line painting shows, or null. */
export function readClaudeStatusLineContext(lines: readonly string[]): TerminalHudContextWindow | null {
  const read = readClaudeStatusLine(lines)
  return read.kind === 'figure' ? read.context : null
}

export function readClaudeStatusLine(lines: readonly string[]): ClaudeStatusLineContextRead {
  const read = readFigure(lines)
  return read === 'refused' ? { kind: 'refused' } : read === null ? { kind: 'none' } : { kind: 'figure', context: read }
}

/** The start of a status-line row: up to three columns in, then a Powerline pill cap if the painter
 *  draws one (usage-band: `  ` on 2.1.295, two plain spaces on the 2.1.294 captures). */
const ROW_START = String.raw`^\s{0,3}(?:[-]\s?)?`
/** usage-band's pill while the user views a subagent's transcript: `↳ general-purpose · Opus 5.5
 *  medium │ ◔ 14% …`. It is drawn IN PLACE of the main session's pill (usage-band `agentContextSpec`)
 *  and states that subagent's model, effort and window, never the session the tab is running, so a
 *  screen showing one says nothing about the main session (Orca stream read, 2026-10-09). */
const SUBAGENT_PILL = new RegExp(`${ROW_START}↳\\s`)
/** The model pair a status line opens with, before its first `│`: `Opus 5.5 xhigh │` (usage-band, as
 *  its `contextSpec` draws `<Family> <version> [<effort>] │`). */
const MODEL_PAIR = new RegExp(`${ROW_START}(Fable|Opus|Sonnet|Haiku) (\\d+(?:\\.\\d+)*)(?: (\\S+))? │`)
const FAMILY_IDS = { Fable: 'fable', Opus: 'opus', Sonnet: 'sonnet', Haiku: 'haiku' } as const
/** Claude Code 2.1.295's effort levels, as its status-line payload's `effort.level` names them. */
const STATUS_LINE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** The model and effort a status line names, in the shape of the claude-hud badge's
 *  (`mobile-terminal-hud-parse.ts`): the catalog family as the id, "Opus 5.5" as the label. */
export type ClaudeStatusLineModelPair = {
  modelLabel: string
  modelId: 'fable' | 'opus' | 'sonnet' | 'haiku'
  effort: string | null
}

/** The model pair the user's own status-line painting opens with, read off the same rows as the
 *  figure (claudeStatusLineRows). The user approved reading it on 2026-10-09, after a hand-typed tab
 *  showed "Opus 5.5" with no effort under a band that said `Opus 5.5 xhigh │`. Null when there is
 *  none and when it is not one unambiguous pair: two rows naming a pair, an effort word Claude Code
 *  does not have, or a subagent's pill on screen. A pair with no effort word is the model alone,
 *  as the mod draws a model that takes none. */
export function readClaudeStatusLineModel(lines: readonly string[]): ClaudeStatusLineModelPair | null {
  const { rows } = claudeStatusLineRows(lines)
  const pairs: ClaudeStatusLineModelPair[] = []
  for (const index of rows) {
    const row = lines[index] ?? ''
    if (SUBAGENT_PILL.test(row)) {
      return null
    }
    const match = MODEL_PAIR.exec(row)
    if (!match) {
      continue
    }
    const effort = match[3] ?? null
    if (effort !== null && !STATUS_LINE_EFFORTS.has(effort)) {
      return null
    }
    const family = match[1] as keyof typeof FAMILY_IDS
    pairs.push({ modelLabel: `${family} ${match[2]!}`, modelId: FAMILY_IDS[family], effort })
  }
  return pairs.length === 1 ? pairs[0]! : null
}

function readFigure(lines: readonly string[]): TerminalHudContextWindow | 'refused' | null {
  const { rows, width } = claudeStatusLineRows(lines)
  if (rows.length === 0) {
    return null
  }
  // A subagent's pill states that subagent's window, not this session's.
  if (rows.some((index) => SUBAGENT_PILL.test(lines[index] ?? ''))) {
    return 'refused'
  }
  const found: { figure: Figure; index: number }[] = []
  for (const index of rows) {
    const figures = figuresOn(lines[index] ?? '')
    if (figures === null) {
      return 'refused'
    }
    found.push(...figures.map((figure) => ({ figure, index })))
  }
  if (found.length !== 1) {
    return found.length === 0 ? null : 'refused'
  }
  const { figure, index } = found[0]!
  // A row that fills the pane may be wrapped onto the next, and one after a full row may be the
  // tail of it: the figure may then be cut in two.
  const fills = (row: string | undefined) =>
    row !== undefined && !isClaudeBoxRule(row) && Array.from(row.trimEnd()).length >= width
  if (fills(lines[index]) || fills(lines[index - 1])) {
    return 'refused'
  }
  const usedPercent = checkedPercent(figure)
  if (usedPercent === null) {
    return 'refused'
  }
  return { usedPercent, usedLabel: figure.used, windowLabel: figure.window }
}
