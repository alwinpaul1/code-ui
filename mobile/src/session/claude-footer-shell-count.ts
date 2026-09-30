import { rowsUnderAgentInput } from './mobile-terminal-hud-context-rows'

// Moved out of mobile-terminal-hud-parse.ts, which re-exports the reader for its callers.
//
// Claude Code's composer footer prints "· N shells" while background shells run
// ("▶▶ auto mode on · 4 shells · ← for agents", real screen 2026-09-14). The
// middot separator keeps it from matching "4 shells" inside ordinary output,
// but not inside an answer that quotes the footer, so only the last eight rows
// under the input row are read (rowsUnderAgentInput).
const FOOTER_SHELL_COUNT = /[·•]\s*(\d+)\s+shells?\b/

/** The background-shell count Claude Code's footer states, or null when the
 *  footer is not on screen (so the caller keeps its own derived count). */
export function parseClaudeRunningShellCount(lines: readonly string[]): number | null {
  for (const line of lines.slice(Math.max(lines.length - 8, rowsUnderAgentInput(lines)))) {
    const match = FOOTER_SHELL_COUNT.exec(line)
    if (match) {
      const count = Number(match[1])
      if (Number.isFinite(count) && count >= 0) {
        return count
      }
    }
  }
  return null
}

/** Spread onto the observation only when a footer count is on screen, so a
 *  screen without one leaves the field absent rather than a null the caller
 *  would have to distinguish. */
export function runningShellCountField(lines: readonly string[]): { runningShellCount?: number } {
  const count = parseClaudeRunningShellCount(lines)
  return count === null ? {} : { runningShellCount: count }
}
