// Codex's collaboration mode as its footer states it. Moved out of mobile-terminal-hud-parse.ts,
// which re-exports it for its callers.

export type TerminalAgentMode = 'default' | 'plan'

export const CODEX_AGENT_MODES: ReadonlyArray<{
  id: TerminalAgentMode
  label: string
  hint: string
}> = [
  { id: 'default', label: 'Default', hint: 'Codex works on the task directly' },
  { id: 'plan', label: 'Plan', hint: 'Codex writes a plan before making changes' }
]

/** Codex's Plan hint. Claude Code's own mode rows put "on" before theirs
 *  ("⏸ plan mode on (shift+tab to cycle)"), so this matches none of them. */
export const CODEX_PLAN_HINT = /Plan mode \(shift\+tab to cycle\)/

/** Codex prints "Plan mode (shift+tab to cycle)" at the footer's right edge in
 *  Plan mode and nothing in Default. The last few lines are the footer. */
export function parseCodexAgentMode(lines: readonly string[]): TerminalAgentMode {
  return CODEX_PLAN_HINT.test(lines.slice(-4).join('\n')) ? 'plan' : 'default'
}
