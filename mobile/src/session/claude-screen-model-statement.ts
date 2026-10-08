import { claudeComposerRules } from './claude-composer-screen'
import { claudeIdFromLabel, claudeTranscriptModelName, type TranscriptModel } from './claude-transcript-model'

/**
 * What Claude Code says about its own model and effort on screen, with nothing
 * set up on the host (no beacon, no status line, no plugin), in the default and
 * the fullscreen TUI alike. Two rows, both read from real Claude Code 2.1.294
 * screens (fixtures/claude-spinner-effort-2.1.294.ts and
 * fixtures/claude-model-toast-2.1.294.ts):
 *
 * - The working spinner states the effort on every thinking turn:
 *   `✻ Gallivanting… (2s · thinking with xhigh effort)`, and with a hook
 *   running `✻ Burrowing… (Syncing CodeGraph index… 0/3 · 3s · ↓ 163 tokens ·
 *   thinking with xhigh effort)`. Between thinking phases it says `thought for
 *   2s`, and Sonnet 5.5 says just `thinking`: no effort, which states nothing.
 * - The alt+p model picker writes nothing to the transcript. It shows a toast
 *   for about two seconds: `Model set to sonnet (claude-sonnet-5-5) for this
 *   session only` (or `… and saved as your default for new sessions`).
 *
 * The `◐ medium · /effort` row some screens show is a user's own mod, not
 * Claude Code's, and is never read.
 *
 * Both are read only where Claude Code draws them, so the same words in a reply
 * or a tool's output are not:
 * - The spinner row is the first column-0 row above the input box's top rule.
 *   Everything Claude draws between them (a tip's `⎿` rows, a status line) is
 *   indented, and every reply and tool row is too (`⏺` opens a reply, and its
 *   rows continue at two columns). The row must be whole: glyph, verb, `…`,
 *   and a parenthesis CLOSED on the same row, with the effort as its last part.
 *   A phone-width pane wraps a long spinner onto a second column-0 row
 *   (`thinking with high effort)` under `· Mustering… (running Stop hooks… 2/3
 *   ·`); that row is not a spinner, so the read refuses.
 * - The toast is drawn flush with the box's right edge, two columns in (the
 *   footer's `paddingX: 2`): at the right of the first footer row at desktop
 *   width, on a footer row of its own at 44 columns (cut with `…` after the id),
 *   and in fullscreen on the row directly above the box's top rule. A reply's
 *   copy is indented two columns from the left and is not flush.
 */
export type ClaudeScreenModelStatement = {
  /** A live spinner row was found where Claude draws one. */
  spinner: boolean
  /** The effort that spinner states, or null when it states none (or was cut). */
  effort: string | null
  /** The model an alt+p toast on screen says was just set. */
  toast: TranscriptModel | null
}

const SPINNER_ROW = /^[✳✻✽✶✢·*] \p{Lu}[\p{L}'’-]+… \(([^()]*)\)$/u
const EFFORT_PART = /^thinking with (low|medium|high|xhigh|max) effort$/
const TOAST = /(?:^| {2})Model set to [^()]+? \((claude-[a-z0-9-]+(?:\[[a-z0-9]+\])?)\)(.*)$/i
const TOAST_TAILS = [' for this session only', ' and saved as your default for new sessions']

/** The live spinner's effort. `spinner` is false when no spinner row sits where
 *  Claude draws one (including when the screen has no input box at all). */
export function readClaudeSpinnerEffort(lines: readonly string[]): { spinner: boolean; effort: string | null } {
  const rules = claudeComposerRules(lines)
  if (rules === null) {
    return { spinner: false, effort: null }
  }
  for (let at = rules.top - 1; at >= 0; at--) {
    const row = lines[at]!
    if (row.trim() === '' || /^\s/.test(row)) {
      continue
    }
    const match = SPINNER_ROW.exec(row.trimEnd())
    if (!match) {
      return { spinner: false, effort: null }
    }
    const parts = match[1]!.split(' · ')
    return { spinner: true, effort: EFFORT_PART.exec(parts[parts.length - 1]!.trim())?.[1] ?? null }
  }
  return { spinner: false, effort: null }
}

function toastOn(row: string, edge: number): TranscriptModel | null {
  const text = row.trimEnd()
  if (Array.from(text).length !== edge) {
    return null
  }
  const match = TOAST.exec(text)
  if (!match) {
    return null
  }
  const tail = match[2]!
  // The whole wording, or the pane cut it short with an ellipsis.
  const whole = tail === '' || TOAST_TAILS.includes(tail)
  const cut = tail.endsWith('…') && TOAST_TAILS.some((full) => full.startsWith(tail.slice(0, -1)))
  if (!whole && !cut) {
    return null
  }
  const model = claudeIdFromLabel(match[1]!)
  const label = model === null ? null : claudeTranscriptModelName(model)
  return model === null || label === null ? null : { model, label }
}

/** The model an alt+p toast on screen names, or null. */
export function readClaudeModelToast(lines: readonly string[]): TranscriptModel | null {
  const rules = claudeComposerRules(lines)
  if (rules === null) {
    return null
  }
  const edge = Array.from(lines[rules.top]!.trimEnd()).length - 2
  for (let at = rules.bottom + 1; at < lines.length; at++) {
    const toast = toastOn(lines[at]!, edge)
    if (toast) {
      return toast
    }
  }
  // Fullscreen: right-aligned on the row above the box, so it opens with far
  // more than a reply's two-column indent.
  let above = rules.top - 1
  while (above >= 0 && lines[above]!.trim() === '') {
    above--
  }
  const row = above >= 0 ? lines[above]! : ''
  return /^ {3}/.test(row) ? toastOn(row, edge) : null
}

export function readClaudeScreenModelStatement(lines: readonly string[]): ClaudeScreenModelStatement {
  return { ...readClaudeSpinnerEffort(lines), toast: readClaudeModelToast(lines) }
}
