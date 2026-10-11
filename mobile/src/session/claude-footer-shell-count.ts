import { rowsUnderAgentInput } from './mobile-terminal-hud-context-rows'

// Moved out of mobile-terminal-hud-parse.ts, which re-exports the reader for its callers.
//
// Claude Code's composer footer prints "· N shells" while background shells run
// ("▶▶ auto mode on · 4 shells · ← for agents", real screen 2026-09-14). The
// middot separator keeps it from matching "4 shells" inside ordinary output,
// but not inside an answer that quotes the footer, so only the last eight rows
// under the input row are read (rowsUnderAgentInput).
const FOOTER_SHELL_COUNT = /[·•]\s*(\d+)\s+shells?\b/

/** The mode row with NO pill on it: Claude Code 2.1.296 draws its
 *  "(shift+tab to cycle)" hint beside the mode only while the row holds no
 *  task pill, and drops the hint the moment a pill appears. Seen on every
 *  capture of 2026-10-10 and 2026-10-11 (fixtures/claude-busy-lead-tasks-2.1.296):
 *  "⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents" with nothing
 *  running, "⏵⏵ bypass permissions on · 2 shells · ← for agents" with two shells,
 *  and the hint back within a second of the last shell's end. At 40 columns and
 *  under the hint is gone even with no pill, and at 28 the pill itself is
 *  dropped, so only the hint's presence says zero, never a row without a count.
 *  A row naming any count ("1 monitor", "N background tasks") is not this. */
const FOOTER_NO_PILL = /\(shift\+tab to cycle\)/
const FOOTER_ANY_PILL = /[·•]\s*\d+\s+\S/

/** The background-shell count Claude Code's footer states: its "· N shells"
 *  pill, or 0 when the mode row says it holds no pill at all
 *  (FOOTER_NO_PILL). Null when the footer is not on screen or does not say (a
 *  dialog over it, a row cut short), so the caller keeps its own derived count.
 *  Why the zero matters: the footer paints nothing at zero, and on a tab with
 *  no beacon (a hand-started `claude`, which carries no launch flag) a shell
 *  that ended while the lead worked had nothing else to retire it, and stayed
 *  "running" for as long as the lead kept working (2026-10-11). */
export function parseClaudeRunningShellCount(lines: readonly string[]): number | null {
  const footer = lines.slice(Math.max(lines.length - 8, rowsUnderAgentInput(lines)))
  for (const line of footer) {
    const match = FOOTER_SHELL_COUNT.exec(line)
    if (match) {
      const count = Number(match[1])
      if (Number.isFinite(count) && count >= 0) {
        return count
      }
    }
  }
  return footer.some((line) => FOOTER_NO_PILL.test(line) && !FOOTER_ANY_PILL.test(line)) ? 0 : null
}

/** Spread onto the observation only when a footer count is on screen, so a
 *  screen without one leaves the field absent rather than a null the caller
 *  would have to distinguish. */
export function runningShellCountField(lines: readonly string[]): { runningShellCount?: number } {
  const count = parseClaudeRunningShellCount(lines)
  return count === null ? {} : { runningShellCount: count }
}
