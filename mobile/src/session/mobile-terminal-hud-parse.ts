const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

export type TerminalHudObservation = {
  /** Model as the status line names it, e.g. "Fable 5.1", "Opus 4.8 (1M context)". */
  modelLabel: string
  /** Catalog id (Claude) or the raw provider model (Codex), or null when the
   *  status line names no model. */
  modelId: string | null
  /** Effort level printed after the model, when the HUD shows one. */
  effort: string | null
  /** Context window usage when the status line prints it (claude-hud's
   *  "78% (776k/1.0M)" or Code UI's "ctx 54% 537.2k/1M"); null otherwise. */
  context: TerminalHudContextWindow | null
  /** Claude Code's permission mode as its input footer states it ("⏵⏵ accept
   *  edits on (shift+tab to cycle)"); 'default' when the footer shows none. */
  permissionMode: TerminalPermissionMode
  /** Codex's collaboration mode from its footer ("Plan mode (shift+tab to
   *  cycle)" or nothing for Default). Absent for agents without one. */
  agentMode?: TerminalAgentMode | null
}

export type TerminalAgentMode = 'default' | 'plan'

export const CODEX_AGENT_MODES: ReadonlyArray<{
  id: TerminalAgentMode
  label: string
  hint: string
}> = [
  { id: 'default', label: 'Default', hint: 'Codex works on the task directly' },
  { id: 'plan', label: 'Plan', hint: 'Codex writes a plan before making changes' }
]

/** Codex prints "Plan mode (shift+tab to cycle)" at the footer's right edge in
 *  Plan mode and nothing in Default. The last few lines are the footer. */
export function parseCodexAgentMode(lines: readonly string[]): TerminalAgentMode {
  return /Plan mode \(shift\+tab to cycle\)/.test(lines.slice(-4).join('\n')) ? 'plan' : 'default'
}

// Codex only states its context window in the `/status` box:
//   "│  Context window:              97% left (19.5K used / 258K)   │"
// It reports what is LEFT; the ring shows what is used.
const CODEX_STATUS_CONTEXT =
  /Context window:\s+(\d{1,3})%\s+left\s*\(\s*([\d.]+[kKmM]?)\s+used\s*\/\s*([\d.]+[kKmM]?)\s*\)/

export function parseCodexStatusContext(lines: readonly string[]): TerminalHudContextWindow | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = CODEX_STATUS_CONTEXT.exec(lines[index] ?? '')
    if (!match) {
      continue
    }
    const left = Number(match[1])
    if (!Number.isFinite(left) || left < 0 || left > 100) {
      continue
    }
    return { usedPercent: 100 - left, usedLabel: match[2] ?? null, windowLabel: match[3] ?? null }
  }
  return null
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
// Codex has no bracket badge. Its input footer states the model and reasoning
// effort as "<model> <effort> · <cwd>", e.g. "gpt-6-astra medium · ~/Project".
// Effort may read "default" (the model's own default) or be absent. Match a
// model token that looks like a provider id (a digit or a dash rules out prose
// like "done · 1:32 PM") followed by a path after the middot.
const CODEX_EFFORT_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
const CODEX_FOOTER =
  /^\s*(\S+?)(?:\s+(minimal|low|medium|high|xhigh|max|ultra|default))?\s+·\s+[~/]/i

/** Whether the Codex input footer ("<model> <effort> · <cwd>") is on screen. */
export function hasCodexFooter(lines: readonly string[]): boolean {
  return lines.slice(-4).some((line) => {
    const match = CODEX_FOOTER.exec(line)
    return match !== null && looksLikeProviderModelId(match[1]!)
  })
}

function looksLikeProviderModelId(token: string): boolean {
  return /\d/.test(token) || token.includes('-')
}

export function parseCodexHudObservation(lines: readonly string[]): TerminalHudObservation | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = CODEX_FOOTER.exec(lines[index] ?? '')
    if (!match) {
      continue
    }
    const model = match[1]!
    if (!looksLikeProviderModelId(model)) {
      continue
    }
    const effortWord = match[2]?.toLowerCase() ?? null
    const effort = effortWord && CODEX_EFFORT_LEVELS.has(effortWord) ? effortWord : null
    return {
      modelLabel: model,
      modelId: model,
      effort,
      context: parseCodexStatusContext(lines),
      permissionMode: parseTerminalPermissionMode(lines),
      agentMode: parseCodexAgentMode(lines)
    }
  }
  return null
}

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
    return {
      modelLabel,
      modelId,
      effort,
      context,
      permissionMode: parseTerminalPermissionMode(lines)
    }
  }
  // No Claude badge on screen; try the Codex footer before giving up.
  return parseCodexHudObservation(lines)
}
