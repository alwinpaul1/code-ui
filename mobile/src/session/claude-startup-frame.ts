import { claudeIdFromLabel, claudeTranscriptModelName } from './claude-transcript-model'

/**
 * The model and effort Claude Code states about ITSELF in the frame it paints
 * when it starts, read off the screen the phone already receives.
 *
 * The idea is Orca's: its desktop renderer reads the same frame to fill its own
 * model and effort pills (`claude-terminal-session-options.ts`, stablyai/orca @
 * 13d94acd, since #12860, 2026-08-06). Orca's read is deliberately loose: it
 * takes the FIRST row containing `Claude Code vX` anywhere in the buffer, looks
 * a two-row window below it (or the frame's bottom edge), takes the lowest row
 * with a `·` or a `with <level> effort`, and accepts an effort whose word was
 * elided to `…`. That is right for a pane Orca spawned and watches from the
 * start, and wrong for a phone attaching to any tab: it would read a frame a
 * reply quotes or a tool captured, and the first frame of a terminal that has
 * run several sessions. This reader differs on purpose:
 *  - the frame's REAL SHAPE is required. 2.1.290's header component lays out a
 *    row of [mascot, text column] with `gap: 2`; the mascot's glyphs span
 *    columns 0 to 8, so on each of the three rows the first eleven columns hold
 *    only mascot art and spaces and the text begins at column 11: `Claude Code
 *    vX`, then the model row, then the working-directory row. A quoted or
 *    indented copy has its art somewhere else and is not read;
 *  - a header that sits inside a reply or tool block (a `⏺` or `⎿` row reachable
 *    upward before a `❯` prompt or the top of the screen) is not read, which is
 *    what a column-0 `cat` of a banner would otherwise pass;
 *  - the NEWEST frame is read, and a newest frame that cannot be read gives
 *    nothing rather than the one before it;
 *  - the model is mapped by FAMILY TOKENS (`claudeIdFromLabel`), never by the
 *    full string, so a `(1M context)` note (2.1.290 still appends one to a 1M
 *    id: `supports_1m_suffix`) changes nothing;
 *  - a pane too narrow for the word "effort" (`with high…`) keeps the model and
 *    drops the effort: this repo refuses rather than guesses (CLAUDE.md, "Agent
 *    screen parsing").
 *
 * Only the model row is read. The third row (`@agent · cwd`, or `cwd · <status>`
 * in fullscreen) carries a `·` of its own and is never looked at.
 *
 * This is the session's own statement AT LAUNCH. It is not updated by `/model`
 * (a later row says that: claude-session-command-pair.ts), and it is not
 * updated by the effort-step keys or the `/effort` slider, which write nothing
 * the phone can read; until the next status line or command, the effort here
 * can be stale. It outranks only the transcript scan's model, and only when the
 * scan names the same model (claude-startup-frame-pair.ts).
 *
 * MODELLED, not captured: no live 2.1.290 frame was captured. The layout and
 * the mascot's glyph spans are read from the 2.1.290 binary's header component
 * (`strings`, 2026-10-06); the effort suffix is the template ` with ${level}
 * effort`, the same builder as 2.1.289's. NOT handled, so refused: a screen
 * reader's mascot-less header, Apple Terminal's smaller fallback mascot (its
 * text column was not verified), and any fullscreen animation frame whose
 * mascot is not the same nine columns.
 */
export type StartupFrameRead = {
  /** The id the family tokens map to, e.g. `claude-opus-5`. */
  model: string
  /** The pill's name for it, e.g. `Opus 5`. */
  label: string
  /** The level the frame states, or null (no effort on the row, or the word
   *  "effort" was cut off by a narrow pane). */
  effort: string | null
}

const EFFORT_LEVEL: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  'extra high': 'xhigh',
  xhigh: 'xhigh',
  max: 'max'
}

// The level words, longest alternatives first. `with <level> effort` whole is
// the only form that states an effort; `with <level>…` is a pane that cut the
// word off and is refused.
const WITH_EFFORT = /\bwith\s+(extra high|xhigh|medium|high|low|max)\s+effort\b/i
const FAMILY_START = /^(fable|mythos|opus|sonnet|haiku)\b/i
/** The glyphs of Claude's mascot (the binary's `Ke`, `Ue`, `Ge` tables, and the older build's). */
const ART = '▐▛▜▌▝▘█▀▄▗▖▟▙▂▞▚'
/** Mascot columns 0 to 8 plus `gap: 2`. */
const TEXT_COLUMN = 11
const ART_COLUMNS = new RegExp(`^[ ${ART}]{${TEXT_COLUMN}}$`)
const HAS_ART = new RegExp(`[${ART}]`)
const HEADER_TEXT = /^Claude Code v\d+(?:\.\d+){1,2}\b/
// A row that opens a reply or tool block.
const BLOCK_ROW = /^\s*[⏺⎿]/
const PROMPT_ROW = /^\s*❯/

// eslint-disable-next-line no-control-regex
const ESCAPES = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?)/g

/** A row as drawn, columns kept: escapes take none, a Windows carriage return and
 *  the blanks after the text are not part of it. */
function drawn(line: string): string {
  return line.replace(ESCAPES, '').replace(/\r/g, '').replace(/\s+$/, '')
}

/** The text a mascot row carries, or null when its first eleven columns are
 *  not mascot art and spaces with some art in them. */
function textBesideArt(row: string): string | null {
  const padded = row.padEnd(TEXT_COLUMN)
  const prefix = padded.slice(0, TEXT_COLUMN)
  return ART_COLUMNS.test(prefix) && HAS_ART.test(prefix) ? padded.slice(TEXT_COLUMN).trim() : null
}

/** A header row of the frame's real shape, and not inside a reply or tool block. */
function isFrameHeader(rows: readonly string[], index: number): boolean {
  if (!HEADER_TEXT.test(textBesideArt(rows[index]!) ?? '') || textBesideArt(rows[index + 1] ?? '') === null || textBesideArt(rows[index + 2] ?? '') === null) {
    return false
  }
  for (let above = index - 1; above >= 0; above -= 1) {
    if (PROMPT_ROW.test(rows[above]!)) {
      return true
    }
    if (BLOCK_ROW.test(rows[above]!)) {
      return false
    }
  }
  return true
}

/** `Opus 5 (1M context)` to `Opus 5`; an unclosed note from a cut row goes too. */
function bareName(name: string): string {
  return name.replace(/\s*\([^)]*\)?/g, '').replace(/…$/, '').trim()
}

function readDescriptor(cell: string): StartupFrameRead | null {
  const beforePlan = cell.split('·')[0]!.trim()
  const effortMatch = WITH_EFFORT.exec(beforePlan)
  // The name ends at "with", whether or not what follows it survived the pane.
  const nameEnd = /\bwith\b/i.exec(beforePlan)?.index
  const name = bareName(nameEnd === undefined ? beforePlan : beforePlan.slice(0, nameEnd))
  // Family tokens: the first word must be a family this knows, and the rest a
  // version `claudeIdFromLabel` can map. Anything else is refused whole, so a
  // custom or unreleased family never draws a guessed pill.
  if (!FAMILY_START.test(name)) {
    return null
  }
  const id = claudeIdFromLabel(name)
  const label = id === null ? null : claudeTranscriptModelName(id)
  if (id === null || label === null) {
    return null
  }
  const level = effortMatch?.[1]?.toLowerCase()
  return { model: id, label, effort: level === undefined ? null : (EFFORT_LEVEL[level] ?? null) }
}

/**
 * The pair the NEWEST startup frame on these rows states, or null.
 *
 * Rows are the host's screen (`terminal.read --screen`). Only the newest header
 * of the frame's real shape is read (a `/clear`-less resume or a second `claude`
 * paints a new one under the old), and a newest frame that cannot be read gives
 * null rather than the older one.
 */
export function readClaudeStartupFrame(lines: readonly string[]): StartupFrameRead | null {
  const rows = lines.map(drawn)
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (isFrameHeader(rows, index)) {
      return readDescriptor(textBesideArt(rows[index + 1]!) ?? '')
    }
  }
  return null
}
