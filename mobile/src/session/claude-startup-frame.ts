import { claudeIdFromLabel, claudeTranscriptModelName } from './claude-transcript-model'

/**
 * The model and effort Claude Code states about ITSELF in the frame it paints
 * when it starts, read off the screen the phone already receives.
 *
 * The shape is ported from Orca's own reader of the same frame,
 * `claude-terminal-session-options.ts` (stablyai/orca @ 13d94acd, shipped since
 * #12860, 2026-08-06): the `Claude Code vX` header row gates it, the model row
 * is searched from the bottom of the frame up so the release-notes panel can
 * never win, and the row reads `<Model> with <level> effort · <plan>`. Two
 * deliberate differences from Orca's:
 *  - the model is mapped by FAMILY TOKENS (`claudeIdFromLabel`), never by the
 *    full string, so Claude Code 2.1.290's rename of `Opus 5 (1M context)` to
 *    `Opus 5` and any other trailing note change nothing;
 *  - a pane too narrow for the word "effort" (`with high…`) keeps the model and
 *    drops the effort. Orca takes the level from the elided form; this repo's
 *    rule is to refuse rather than guess (CLAUDE.md, "Agent screen parsing").
 *
 * This is the session's own statement AT LAUNCH. It is not updated by `/model`
 * (a later row says that: claude-session-command-pair.ts), and it is not
 * updated by the effort-step keys or the `/effort` slider, which write nothing
 * the phone can read; until the next status line or command, the effort here
 * can be stale. It outranks only the transcript scan's model, and only when the
 * scan names the same model (claude-startup-frame-pair.ts).
 *
 * MODELLED, not captured: no live 2.1.290 frame was captured. The wordings are
 * the ones the 2.1.290 binary builds (` with ${level} effort`, the same builder
 * as 2.1.289's, read by `strings` 2026-10-06) and the layouts Orca's tests pin
 * (framed with `╭╰│`, and the unframed logo whose rows sit behind block art).
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
const WITH_ANYTHING = /\bwith\s+(?:extra high|xhigh|medium|high|low|max)\b/i
// Block art the logo and the frame draw before and between cells.
const ART = '▐▛▜▌▝▘█▀▄▖▗▞▚░▒▓│┃╭╮╰╯─━┏┓┗┛'
const HEADER = new RegExp(`^[\\s${ART}]*Claude Code\\s*v?\\d+(?:\\.\\d+){1,2}`, 'i')
const HEADER_REST = /^.*?Claude Code\s*v?\d+(?:\.\d+){1,2}/i
const FAMILY_START = /^(fable|mythos|opus|sonnet|haiku)\b/i
const FRAME_TOP = '╭'
const FRAME_BOTTOM = '╰'
const FRAME_COLUMN = '│'
/** Rows below the header the model row can sit on in an unframed frame. */
const UNFRAMED_WINDOW = 3
/** Rows below the header a framed frame is searched when its bottom edge is not on screen. */
const FRAMED_WINDOW = 8

// eslint-disable-next-line no-control-regex
const ESCAPES = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?)/g

/** A row as drawn: escapes, a Windows carriage return and runs of spaces gone. */
function plain(line: string): string {
  return line.replace(ESCAPES, '').replace(/\r/g, '').replace(/\s+/g, ' ').trim()
}

/** The leftmost cell of a framed row, up to the next border, or an unframed
 *  row behind its block art. The release-notes panel sits right of the second
 *  border and so is never read. */
function leftCell(row: string): string {
  if (row.startsWith(FRAME_COLUMN)) {
    const inner = row.slice(FRAME_COLUMN.length)
    const end = inner.indexOf(FRAME_COLUMN)
    return (end === -1 ? inner : inner.slice(0, end)).trim()
  }
  return row.replace(new RegExp(`^[\\s${ART}]+`), '').trim()
}

function isDescriptor(cell: string): boolean {
  return cell.includes('·') || WITH_ANYTHING.test(cell) || FAMILY_START.test(cell)
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
 * Only the last `Claude Code vX` header is read: an older frame (a `/clear` or
 * a resume paints a new one) is an older statement, and a newest frame that
 * cannot be read gives null rather than the one before it. Rows are the host's
 * screen (`terminal.read --screen`) or an oldest-first stream read.
 */
export function readClaudeStartupFrame(lines: readonly string[]): StartupFrameRead | null {
  const rows = lines.map(plain)
  let header = -1
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (HEADER.test(rows[index]!)) {
      header = index
      break
    }
  }
  if (header === -1) {
    return null
  }
  // ConPTY and a cursor move can drop the gap between the name and the model on
  // one row: `Claude Codev2.1.290Opus 5 with high effort · Claude Max`.
  const joined = leftCell(rows[header]!.replace(HEADER_REST, '').trim())
  const bottom = rows.findIndex((row, index) => index > header && row.startsWith(FRAME_BOTTOM))
  const framed = rows[header]!.startsWith(FRAME_TOP) || rows.slice(header + 1, header + 3).some((row) => row.startsWith(FRAME_COLUMN))
  const last = bottom > 0 ? bottom - 1 : Math.min(header + (framed ? FRAMED_WINDOW : UNFRAMED_WINDOW), rows.length - 1)
  // Bottom-up: the model row is the lowest descriptor-like cell above the
  // frame's bottom edge, so the welcome art and the notes panel never win.
  for (let index = last; index > header; index -= 1) {
    const cell = leftCell(rows[index]!)
    if (isDescriptor(cell)) {
      return readDescriptor(cell)
    }
  }
  return joined !== '' && isDescriptor(joined) ? readDescriptor(joined) : null
}
