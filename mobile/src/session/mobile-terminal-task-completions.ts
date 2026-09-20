import type { ScreenTaskCompletion } from './mobile-background-tasks'

/**
 * Background-task completions Claude Code has stated on its own screen.
 *
 * Why this exists: when a task's notification lands, Claude paints the
 * notification's `<summary>` into its scrollback as a `⏺` row, the same way
 * it paints its own prose. On a hand-started tab that row is the only place
 * the phone can learn that a shell finished mid-turn: there is no beacon, the
 * transcript record is one Orca's reader never surfaces, and the pane stays
 * `working` (2026-09-20, "3 running tasks" over a "· 2 shells" footer).
 *
 * The summary's grammar is fixed (2,600 real records on this machine):
 *
 *     Background command "<label>" completed (exit code N)
 *     Background command "<label>" failed with exit code N
 *     Background command "<label>" was stopped
 *     Background command "<label>" was stopped because the system is running low on memory
 *
 * where `<label>` is the launch's `description`, or its whole command when
 * it has none. The row wraps at the terminal's width, so the label can
 * arrive re-wrapped; unlike a `❯` prompt row, the wrap IS decidable here,
 * because the grammar closes the match: the rows are gathered until one ends
 * in a terminator. A row the terminal cut with an ellipsis is refused.
 *
 * Row shape from `tmux capture-pane -p` of Claude Code 2.1.278 at 46
 * columns (2026-09-20, fixtures/claude-screen-task-completions-2.1.278.txt):
 *
 *     ⏺ Background command "Short nap for a capture"
 *     completed (exit code 0)
 *
 *     ⏺ Background command "A failing nap for a
 *     capture" failed with exit code 1
 *
 * The continuation sits at COLUMN 0. That is unlike everything else Claude
 * wraps — its own prose and an accepted prompt continue two spaces in — and
 * the first cut of this parser, written before the capture, assumed the
 * two-space shape and would have read neither row. A blank row, or a row
 * that opens another bullet, prompt or tool line, ends the gathering.
 */

/** The opening row: Claude's `⏺ ` bullet, then the summary's fixed start. */
const HEAD = /^⏺ Background command "(.*)$/
/** A wrapped continuation row: at column 0, and not the start of anything
 *  else Claude paints there. */
const CONTINUATION = /^(?![\s⏺⎿❯›>✻✳✽✶✢·*])(\S.*)$/
/** How the summary ends, with the status word to report. */
const TAIL = /^(.*)" (?:(completed) \(exit code \d+\)|(failed) with exit code \d+|was (stopped)(?: because the system is running low on memory)?)\s*$/
/** A summary never wraps further than this at a phone's width; past it the
 *  rows are something else. */
const MAX_ROWS = 12
const CUT = /[…]\s*$/

export function taskCompletionsFromScreen(screen: readonly string[]): ScreenTaskCompletion[] {
  const found: ScreenTaskCompletion[] = []
  let index = 0
  while (index < screen.length) {
    const head = HEAD.exec(screen[index] ?? '')
    if (!head) {
      index += 1
      continue
    }
    let text = head[1] ?? ''
    let end = index
    let completion = closeSummary(text)
    while (!completion && end - index < MAX_ROWS && !CUT.test(text)) {
      const next = CONTINUATION.exec(screen[end + 1] ?? '')
      if (!next) {
        break
      }
      end += 1
      text = `${text} ${next[1] ?? ''}`
      completion = closeSummary(text)
    }
    if (completion) {
      found.push(completion)
      index = end + 1
    } else {
      index += 1
    }
  }
  return found
}

function closeSummary(text: string): ScreenTaskCompletion | null {
  const tail = TAIL.exec(text)
  if (!tail) {
    return null
  }
  const label = (tail[1] ?? '').replaceAll(/\s+/g, ' ').trim()
  const status = tail[2] ?? tail[3] ?? tail[4] ?? null
  return label.length > 0 && status ? { label, status } : null
}
