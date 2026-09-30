import { hasCodexFooter } from './mobile-terminal-hud-parse'
import {
  CODEX_COMPOSER_ROW,
  codexPendingInputPreviewRows,
  codexPendingPreviewStart
} from './codex-terminal-queued-messages'
// Codex's `/model` picker as it renders in the terminal screen buffer. Codex
// 0.153.x has no non-interactive way to set the model or reasoning effort
// mid-session — `/model <slug>` is unreliable and a second argument is sent to
// the model as chat — so the phone drives the picker: read the rows, move the
// `›` cursor with arrow keys, confirm with Enter. Everything here is a pure
// parse of screen lines; the driver lives in codex-picker-apply.ts.
//
// Model step (header "Select Model and Effort"):
//   "  1. gpt-6-astra (default)  Our most capable model for complex work."
//   "› 2. gpt-5.6-sol (current)  Reliable agentic workhorse for everyday tasks."
// Effort step (header "Select Reasoning Level for <slug>"):
//   "  1. Low (default)         Fast responses with lighter reasoning"
//   "› 4. Extra high (current)  Extra high reasoning depth for complex problems"
//   "  5. More reasoning…       Max and Ultra consume usage limits faster"

export type CodexPickerRow = {
  /** 1-based number as printed. */
  index: number
  /** The slug (model step) or the effort label as printed (effort step). */
  name: string
  description: string
  isDefault: boolean
  isCurrent: boolean
  /** Effort step only: the "More reasoning…" expander row. */
  isMore: boolean
}

export type CodexPickerScreen = {
  step: 'model' | 'effort'
  /** Effort step: the slug the header names. */
  model: string | null
  rows: CodexPickerRow[]
  /** 1-based index the `›` cursor sits on, or null when not drawn. */
  cursorIndex: number | null
}

const MODEL_HEADER = /^\s*Select Model and Effort\s*$/
const EFFORT_HEADER = /^\s*Select Reasoning Level for\s+(\S+)\s*$/
const FOOTER = /Press enter to confirm or esc to go back/
// "› 2. gpt-5.6-sol (current)  description" — name runs to the flag or a
// two-space gap; the description is whatever follows.
// All three cursor glyphs, as every sibling parser accepts: codex-terminal-permission,
// mobile-terminal-permission-options and mobile-terminal-queued-messages all take
// [❯›>]. This one took [›>] only, so a build that draws ❯ would drop the highlighted
// row entirely — no cursor and no current model, which fails every model change with
// "Couldn't apply it through the Codex picker" and blanks the model pill.
// Codex 0.153.4 draws ›; this is drift insurance, not a live break.
const ROW = /^([❯›>]?)\s*(\d+)\.\s+(.+?)(?:\s+\((default|current)\))*(?:\s{2,}(.*))?$/

function parseRow(line: string): CodexPickerRow | null {
  const match = ROW.exec(line.trimStart())
  if (!match) {
    return null
  }
  const [, cursor, index, rawName, , description] = match
  // The regex consumes flags without keeping both; re-scan the line for them.
  const flags = line.match(/\((default|current)\)/g) ?? []
  const name = rawName!.trim()
  return {
    index: Number(index),
    name,
    description: (description ?? '').trim(),
    isDefault: flags.some((flag) => flag === '(default)'),
    isCurrent: flags.some((flag) => flag === '(current)'),
    isMore: /^More reasoning/i.test(name),
    ...(cursor ? {} : {})
  }
}

/**
 * Find the picker in a screen read. The picker paints below the transcript,
 * so the LAST header on screen is the live one; rows run from there to the
 * "Press enter" footer.
 */
export function parseCodexPickerScreen(lines: readonly string[]): CodexPickerScreen | null {
  let headerAt = -1
  let step: CodexPickerScreen['step'] | null = null
  let model: string | null = null
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? ''
    if (MODEL_HEADER.test(line)) {
      headerAt = index
      step = 'model'
      break
    }
    const effort = EFFORT_HEADER.exec(line)
    if (effort) {
      headerAt = index
      step = 'effort'
      model = effort[1] ?? null
      break
    }
  }
  if (headerAt < 0 || !step) {
    return null
  }
  const rows: CodexPickerRow[] = []
  let cursorIndex: number | null = null
  for (let index = headerAt + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (FOOTER.test(line)) {
      break
    }
    const row = parseRow(line)
    if (!row) {
      continue
    }
    rows.push(row)
    if (/^[❯›>]/.test(line.trimStart())) {
      cursorIndex = row.index
    }
  }
  if (rows.length === 0) {
    return null
  }
  return { step, model, rows, cursorIndex }
}

// Ported from Orca's `hasBusyStatusRowAbove` (src/main/runtime/codex-terminal-readiness.ts, v1.4.217),
// extended for the rows Codex draws between the status row and the composer.
// Why "to interrupt)" and not "working": reasoning summaries replace the word, and a remapped key
// still ends the row this way.
const CODEX_BUSY_STATUS_MARKER = 'to interrupt)'
/**
 * Whether Codex's busy row ("• Working (5s • esc to interrupt)") sits directly above the composer:
 * the last non-blank line above it, once an open slash or @ popup (0.158 draws it above the
 * composer, its selected row marked `›`), the pending-input preview (a blank line, then "Queued
 * follow-up inputs" or "Messages to be submitted…" blocks, headers at column 0) and one `└` status
 * detail with its wrapped rows (a Tip, the auto-review status, a retry error, parallel approval
 * reviews) are stepped over (codexPendingPreviewStart). A finished answer can quote the row anywhere
 * higher up, and 0.158 puts a timestamp between a quoted row and the composer. The row is not a fixed
 * distance from the bottom (0.155: sixth line up; 0.158.0, whose footer gained "? for shortcuts":
 * seventh; every queued message and popup row adds lines between it and the composer), which is why
 * a tail window was wrong in both directions. No composer on screen means no verdict: a pager or a
 * `cat`ed transcript can hold any text.
 */
function hasBusyStatusRowAbove(lines: readonly string[]): boolean {
  const composer = lines.findLastIndex((line) => CODEX_COMPOSER_ROW.test(line))
  if (composer === -1) {
    return false
  }
  const above = lines.slice(0, codexPendingPreviewStart(lines, composer)).filter((line) => line.trim() !== '')
  // Step over one status detail block: its wrapped rows (four-space indent, status_indicator_widget.rs
  // wraps a detail under "  └ " then four spaces) back to the `└` row.
  let detail = above.length - 1
  while (detail >= 0 && /^\s{4,}\S/.test(above[detail] ?? '')) {
    detail -= 1
  }
  const row = above[detail]?.trimStart().startsWith('└') ? above[detail - 1] : above.at(-1)
  return row?.includes(CODEX_BUSY_STATUS_MARKER) ?? false
}

/** A live steer group counts as a running turn: Codex holds a steer ("Messages to be submitted after
 *  next tool call") only while a turn runs, and hides the busy row while an answer streams, so the
 *  steer header is the only sign of the turn then. Found by the queue reader's own scan of the
 *  pending-input preview, wrapped or not (codex-terminal-queued-messages.ts). */
function isCodexTurnRunning(lines: readonly string[]): boolean {
  if (hasBusyStatusRowAbove(lines)) {
    return true
  }
  // The scan reads only the preview directly above the composer, headers at column 0: a steer header
  // quoted higher up in the transcript, or indented in an answer, is not a live queue.
  return codexPendingInputPreviewRows(lines).steerHeaders.size > 0
}

/** Whether the Codex TUI is idle at its prompt with no turn running. The
 *  placeholder disappears once the composer holds a draft, so the footer line
 *  ("<model> <effort> · <cwd>") counts as evidence of the prompt too. */
export function isCodexIdle(lines: readonly string[]): boolean {
  if (isCodexTurnRunning(lines) || parseCodexPickerScreen(lines)) {
    return false
  }
  return /Ask Codex to do anything/.test(lines.slice(-6).join('\n')) || hasCodexFooter(lines)
}

/** Whether a Codex turn is in progress (a stray Esc here would interrupt it). */
export function isCodexWorking(lines: readonly string[]): boolean {
  return isCodexTurnRunning(lines)
}

/** Whether two Codex model names are the same model. Case does not count: Codex 0.158.0 prints the
 *  footer's model as "GPT-6-Sol" where 0.155.1 printed the slug "gpt-6-sol" (codex-0158-screens.test.ts
 *  holds both captures), and the account lists the slug. */
export function sameCodexModel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Match a picker effort label ("Extra high") to a discovered level id ("xhigh"). */
export function matchCodexEffortRow(
  rows: readonly CodexPickerRow[],
  target: { id: string; label: string }
): CodexPickerRow | undefined {
  const wanted = new Set(
    [target.id, target.label].map((value) => value.trim().toLowerCase().replace(/\s+/g, ' '))
  )
  return rows.find((row) => !row.isMore && wanted.has(row.name.trim().toLowerCase()))
}
