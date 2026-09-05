const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

export type TerminalHudObservation = {
  /** Model as the status line names it, e.g. "Fable 5.1", "Opus 4.8 (1M context)". */
  modelLabel: string
  /** Catalog id the label maps to, or null when no family word is present. */
  modelId: 'fable' | 'opus' | 'sonnet' | 'haiku' | null
  /** Effort level printed after the model, when the HUD shows one. */
  effort: string | null
}

const BADGE = /\[([^\]|]+?)\s*\|[^\]]*\]/

/**
 * Read the model badge of the Claude Code status line (the claude-hud
 * `[Model effort | Auth]` bracket) from a terminal screen.
 *
 * Why: this is the one place the running session states both its model and its
 * effort. Orca's hook report carries only the model, and the transcript's
 * `effort` field never reaches the phone, so the phone reads what the terminal
 * shows instead. `ultracode(level)` counts as its inner level.
 */
export function parseTerminalHudObservation(
  lines: readonly string[]
): TerminalHudObservation | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = BADGE.exec(lines[index] ?? '')
    if (!match) {
      continue
    }
    const words = match[1]!.trim().split(/\s+/)
    let effort: string | null = null
    const last = words[words.length - 1]?.toLowerCase() ?? ''
    const ultracode = /^ultracode\(([a-z]+)\)$/.exec(last)
    if (ultracode && EFFORT_LEVELS.has(ultracode[1]!)) {
      effort = ultracode[1]!
      words.pop()
    } else if (EFFORT_LEVELS.has(last)) {
      effort = last
      words.pop()
    }
    const modelLabel = words.join(' ')
    if (!modelLabel) {
      continue
    }
    const lower = modelLabel.toLowerCase()
    const modelId = lower.includes('fable')
      ? 'fable'
      : lower.includes('opus')
        ? 'opus'
        : lower.includes('sonnet')
          ? 'sonnet'
          : lower.includes('haiku')
            ? 'haiku'
            : null
    if (!modelId) {
      continue
    }
    return { modelLabel, modelId, effort }
  }
  return null
}
