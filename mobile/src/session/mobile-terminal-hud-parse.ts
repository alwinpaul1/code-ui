const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

export type TerminalHudObservation = {
  /** Model as the status line names it, e.g. "Fable 5.1", "Opus 4.8 (1M context)". */
  modelLabel: string
  /** Catalog id the label maps to, or null when no family word is present. */
  modelId: 'fable' | 'opus' | 'sonnet' | 'haiku' | null
  /** Effort level printed after the model, when the HUD shows one. */
  effort: string | null
}

const BADGE = /\[([^\]]+)\]/
/** Separators and labels a status line may put between the model and the effort. */
const FILLER = new Set(['·', '•', '|', '-', '—', ':', 'effort', 'effort:'])

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
    // Only the first segment names the model; "| Max 20x" style suffixes are auth/plan.
    const segment = match[1]!.split('|')[0]!.trim()
    const words: string[] = []
    let effort: string | null = null
    for (const raw of segment.split(/\s+/)) {
      const lower = raw.toLowerCase()
      const ultracode = /^ultracode\(([a-z]+)\)$/.exec(lower)
      if (ultracode && EFFORT_LEVELS.has(ultracode[1]!)) {
        effort = ultracode[1]!
      } else if (EFFORT_LEVELS.has(lower)) {
        effort = lower
      } else if (!FILLER.has(lower)) {
        words.push(raw)
      }
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
