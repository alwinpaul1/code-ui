const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

export type TerminalHudObservation = {
  /** Model as the status line names it, e.g. "Fable 5.1", "Opus 4.8 (1M context)". */
  modelLabel: string
  /** Catalog id the label maps to, or null when no family word is present. */
  modelId: 'fable' | 'opus' | 'sonnet' | 'haiku' | null
  /** Effort level printed after the model, when the HUD shows one. */
  effort: string | null
  /** Context window usage when the status line prints it (claude-hud's
   *  "78% (776k/1.0M)" or Code UI's "ctx 54% 537.2k/1M"); null otherwise. */
  context: TerminalHudContextWindow | null
  /** Claude Code's permission mode as its input footer states it ("⏵⏵ accept
   *  edits on (shift+tab to cycle)"); 'default' when the footer shows none. */
  permissionMode: TerminalPermissionMode
}

export type TerminalPermissionMode =
  | 'default'
  | 'manual'
  | 'acceptEdits'
  | 'plan'
  | 'auto'
  | 'bypassPermissions'

const PERMISSION_MODE_PATTERNS: Array<[RegExp, TerminalPermissionMode]> = [
  [/manual mode on/i, 'manual'],
  [/accept edits on/i, 'acceptEdits'],
  [/plan mode on/i, 'plan'],
  [/auto mode on/i, 'auto'],
  [/bypass permissions on/i, 'bypassPermissions']
]

/** The mode footer sits under the input box; the last match on screen wins. */
export function parseTerminalPermissionMode(lines: readonly string[]): TerminalPermissionMode {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? ''
    for (const [pattern, mode] of PERMISSION_MODE_PATTERNS) {
      if (pattern.test(line)) {
        return mode
      }
    }
  }
  return 'default'
}

export function permissionModeLabel(mode: TerminalPermissionMode): string {
  switch (mode) {
    case 'default':
    case 'manual':
      return 'Manual'
    case 'acceptEdits':
      return 'Accept edits'
    case 'plan':
      return 'Plan'
    case 'auto':
      return 'Auto'
    case 'bypassPermissions':
      return 'Bypass'
    default: {
      const exhaustive: never = mode
      return exhaustive
    }
  }
}

export type TerminalHudContextWindow = {
  usedPercent: number
  /** Human labels as printed, e.g. "537.2k" and "1M"; null when only a percent is shown. */
  usedLabel: string | null
  windowLabel: string | null
}

const CONTEXT_PATTERNS = [
  // Code UI status line: "ctx 54% 537.2k/1M"
  /\bctx\s*:?\s*(\d{1,3})%(?:\s+([\d.]+[kKmM]?)\s*\/\s*([\d.]+[kKmM]?))?/,
  // claude-hud: "78% (776k/1.0M)"
  /(\d{1,3})%\s*\(\s*([\d.]+[kKmM]?)\s*\/\s*([\d.]+[kKmM]?)\s*\)/,
  // Generic "context 54%" / "54% context"
  /\bcontext\s*:?\s*(\d{1,3})%/i,
  /(\d{1,3})%\s*(?:ctx|context)\b/i
]
// On the badge line itself the first percent after the badge is the context
// meter (claude-hud draws "████░░ 61% (60…" there, often cut by the column).
const BARE_PERCENT = /(\d{1,3})%/

export function parseTerminalHudContextWindow(
  line: string,
  options: { allowBarePercent?: boolean } = {}
): TerminalHudContextWindow | null {
  for (const pattern of options.allowBarePercent
    ? [...CONTEXT_PATTERNS, BARE_PERCENT]
    : CONTEXT_PATTERNS) {
    const match = pattern.exec(line)
    if (!match) {
      continue
    }
    const usedPercent = Number(match[1])
    if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
      continue
    }
    return {
      usedPercent,
      usedLabel: match[2] ?? null,
      windowLabel: match[3] ?? null
    }
  }
  return null
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
    // The context figure sits after the badge on the same line, or on the line
    // below when the HUD wraps; the badge line wins when both carry one.
    const line = lines[index] ?? ''
    const context =
      parseTerminalHudContextWindow(line.slice(match.index + match[0].length), {
        allowBarePercent: true
      }) ?? parseTerminalHudContextWindow(lines[index + 1] ?? '')
    return { modelLabel, modelId, effort, context, permissionMode: parseTerminalPermissionMode(lines) }
  }
  return null
}
