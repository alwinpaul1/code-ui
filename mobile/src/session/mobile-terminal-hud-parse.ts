import {
  hasClaudeModeFooter,
  permissionModeLabel,
  readTerminalPermissionMode,
  type TerminalPermissionMode
} from './claude-terminal-mode-footer'
import { SPINNER_VERB_SOURCE } from './mobile-terminal-spinner-line'
import {
  CODEX_AGENT_MODES,
  CODEX_PLAN_HINT,
  parseCodexAgentMode,
  type TerminalAgentMode
} from './codex-terminal-agent-mode'
import { parseClaudeRunningShellCount, runningShellCountField } from './claude-footer-shell-count'
import {
  readClaudeStatusLine,
  readClaudeStatusLineContext,
  readClaudeStatusLineModel,
  type ClaudeStatusLineModelPair
} from './claude-status-line-context'
import {
  CODEX_STATUS_BOX_ROW,
  claudeFullscreenNoticeRow,
  claudeRowsUnderInputBox,
  codexFooterFigureRows,
  isClaudeConversationRow,
  rowsUnderAgentInput
} from './mobile-terminal-hud-context-rows'

// The footer's mode and shell-count readers live beside this parser; its callers import them
// from here.
export { parseClaudeRunningShellCount, permissionModeLabel, readTerminalPermissionMode, type TerminalPermissionMode }
export { CODEX_AGENT_MODES, parseCodexAgentMode, type TerminalAgentMode }

const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
/** Read as the badge's FIRST word, never as a substring of it. */
const MODEL_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const

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
  /** The verb on the agent's own spinner line while it works — Claude Code's
   *  "✳ Cooking… (2m 14s · ↓ 1.2k tokens · esc to interrupt)" — so the phone
   *  can say what the desk says (Claude app parity, 2026-09-12). Null when no
   *  spinner is on screen. */
  activity?: string | null
  /** Claude Code's permission mode as its input footer states it ("⏵⏵ accept
   *  edits on (shift+tab to cycle)"); 'default' when a screen was read and its
   *  footer shows none; null when no screen was read at all (an observation the
   *  beacon or host-status merge built from NO_SCREEN_HUD_OBSERVATION), so
   *  nothing states a mode nobody saw. */
  permissionMode: TerminalPermissionMode | null
  /** The mode the footer actually STATED, or null when no footer row was on
   *  screen. `permissionMode` collapses null to 'default' for the pill; anything
   *  that acts on the mode must read this instead. */
  permissionModeSeen?: TerminalPermissionMode | null
  /** Codex's collaboration mode from its footer ("Plan mode (shift+tab to
   *  cycle)" or nothing for Default). Absent for agents without one. */
  agentMode?: TerminalAgentMode | null
  /** How many background shells Claude Code's own footer says are running
   *  ("… · 4 shells · ← for agents"). The agent counts these live — every
   *  shell in its process, a subagent's too (2.1.281–2.1.283) — so it caps the
   *  lead's named shells, and is their floor only up to what the lead can
   *  have (`mobile-background-task-footer.ts`). Null when the footer states none. */
  runningShellCount?: number | null
}

// Codex states its context window as what is LEFT; the ring shows what is used.
// Two paintings, both verified live:
//   codex-cli 0.15x `/status` box: "│  Context window:   97% left (19.5K used / 258K)  │"
//   codex-cli 0.153.4 footer, after `/status`: "100% context left" (no token figures)
const CODEX_STATUS_CONTEXT =
  /Context window:\s+(\d{1,3})%\s+left\s*\(\s*([\d.]+[kKmM]?)\s+used\s*\/\s*([\d.]+[kKmM]?)\s*\)/
// "100% context left" (transient) and "Context 100% left" (the `context-remaining`
// status-line item, painted permanently when launched with tui.status_line).
const CODEX_FOOTER_CONTEXT = /(?:^|\s)(?:(\d{1,3})%\s+context\s+left|Context\s+(\d{1,3})%\s+left)(?:\s|$|\s·)/

/** Read only where Codex paints the figure itself: the footer figure off its footer rows, and the
 *  `/status` box off a row whose frame is intact. A whole-screen scan read an answer's "It says 62%
 *  context left" as a 38% ring (mobile-terminal-hud-context-rows.ts). */
export function parseCodexStatusContext(lines: readonly string[]): TerminalHudContextWindow | null {
  for (const line of codexFooterFigureRows(lines, isCodexFooterRow)) {
    const footer = CODEX_FOOTER_CONTEXT.exec(line)
    if (footer) {
      const left = Number(footer[1] ?? footer[2])
      if (Number.isFinite(left) && left >= 0 && left <= 100) {
        // No token figures on this painting: percent only, labels honestly null.
        return { usedPercent: 100 - left, usedLabel: null, windowLabel: null }
      }
    }
  }
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? ''
    const boxed = CODEX_STATUS_BOX_ROW.test(line) ? CODEX_STATUS_CONTEXT.exec(line) : null
    if (boxed) {
      const left = Number(boxed[1])
      if (Number.isFinite(left) && left >= 0 && left <= 100) {
        return { usedPercent: 100 - left, usedLabel: boxed[2] ?? null, windowLabel: boxed[3] ?? null }
      }
    }
  }
  return null
}

// Claude Code's spinner glyphs rotate through these; the verb follows, then an
// ellipsis. Read from the bottom, where the live line sits. The same verb the
// chat's status line reads (mobile-terminal-spinner-line.ts).
const ACTIVITY_LINE = new RegExp(SPINNER_VERB_SOURCE, 'u')

export function parseTerminalActivity(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - 12); index -= 1) {
    const match = ACTIVITY_LINE.exec(lines[index] ?? '')
    if (match) {
      return match[1]!
    }
  }
  return null
}

/** The field only when a spinner is on screen, so an idle observation keeps
 *  the shape every other reader expects. */
function activityField(lines: readonly string[]): { activity?: string } {
  const activity = parseTerminalActivity(lines)
  return activity ? { activity } : {}
}

/** The footer's mode for the pill: 'default' when no footer states one. */
export function parseTerminalPermissionMode(lines: readonly string[]): TerminalPermissionMode {
  return readTerminalPermissionMode(lines) ?? 'default'
}

export type TerminalHudContextWindow = {
  usedPercent: number
  /** Windows the agent itself reported alongside its context — Codex carries
   *  the ones its /status prints. Rides here rather than as a new prop because
   *  every layer from the controller to the sheet already passes this object. */
  limits?: readonly {
    usedPercent: number
    windowMinutes: number | null
    /** Epoch SECONDS, as Codex prints them; the sheet formats against Date.now()/1000. */
    resetsAt: number | null
    /** Label when the host names the window (e.g. "Fable"); else derived from its length. */
    name?: string
  }[]
  planType?: string | null
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
// Claude Code's OWN footer, painted with no status line configured (strings in
// the 2.1.266 binary: "% until auto-compact", "Context low (", "% remaining)";
// 2.1.283 draws them with 2.1.282's code, and the mode footer with the same
// output from a reworked row, 2026-09-26).
// These state what is LEFT, so the ring shows 100 minus the figure. "Until
// auto-compact" is measured to the compaction point rather than the window's
// end; it is the closest figure Claude Code offers a bare host and is labelled
// by the agent itself, so it is shown as is rather than re-derived.
const REMAINING_PATTERNS = [
  /(\d{1,3})%\s+until\s+auto-compact/i,
  /Context left until auto-compact:\s*(\d{1,3})%/i,
  /Context low\s*\(\s*(\d{1,3})%\s+remaining\)/i
]
const CLAUDE_FOOTER = /shift\+tab to cycle/i
/** Claude Code's own warning as the first text on its row (the fullscreen notice row). */
const CLAUDE_OWN_WARNING_START = /^\s*(?:Context low\s*\(|\d{1,3}%\s+until\s+auto-compact)/i

// On the badge line itself the first percent after the badge is the context
// meter (claude-hud draws "████░░ 61% (60…" there, often cut by the column).
const BARE_PERCENT = /(\d{1,3})%/

export function parseTerminalHudContextWindow(
  line: string,
  options: { allowBarePercent?: boolean; ownWarningOnly?: boolean } = {}
): TerminalHudContextWindow | null {
  for (const pattern of REMAINING_PATTERNS) {
    const match = pattern.exec(line)
    if (!match) {
      continue
    }
    const left = Number(match[1])
    if (Number.isFinite(left) && left >= 0 && left <= 100) {
      return { usedPercent: 100 - left, usedLabel: null, windowLabel: null }
    }
  }
  if (options.ownWarningOnly) {
    return null
  }
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

/**
 * The status-line model badge, and ONLY that.
 *
 * This used to be `/\[([^\]]+)\]/` — any bracketed text, anywhere on any line
 * — and the model was then accepted if the contents merely CONTAINED a family
 * name. So a line the agent printed set the pill: a list of model ids in source,
 * a file path with "opus" in it, a sentence naming a model. The pill changed to
 * whatever had scrolled past ("wrong model name at some point randomly",
 * 2026-09-15).
 *
 * It was always this loose; what exposed it was removing the launch record and
 * the remembered pick as model sources earlier the same day, which left the
 * screen read carrying far more weight.
 *
 * A status line OPENS with its badge. Agent output is prefixed by a glyph, an
 * indent or prose, but the `\s*` Claude's own two-space status line needs also
 * passes a tool's five-space output, so the row must sit under the agent's own
 * input row too (rowsUnderAgentInput). Anchoring is the project's own rule for
 * an ambiguous screen: refuse rather than guess, and let the beacon answer.
 */
const BADGE = /^\s*\[([^\]]+)\]/
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
// like "done · 1:32 PM") followed by a path after the middot — or, when Codex
// was launched with `tui.status_line`, by its "Context N% left" item instead.
const CODEX_EFFORT_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
const CODEX_FOOTER =
  /^\s*(\S+?)(?:\s+(minimal|low|medium|high|xhigh|max|ultra|default))?\s+·\s+(?:[~/]|Context\s+\d{1,3}%\s+left)/i

function isCodexFooterRow(line: string): boolean {
  const match = CODEX_FOOTER.exec(line)
  return match !== null && looksLikeProviderModelId(match[1]!)
}

/** Whether the Codex input footer ("<model> <effort> · <cwd>") is on screen. */
export function hasCodexFooter(lines: readonly string[]): boolean {
  return lines.slice(-4).some(isCodexFooterRow)
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
      permissionModeSeen: readTerminalPermissionMode(lines),
      agentMode: parseCodexAgentMode(lines)
    }
  }
  return null
}

export function parseTerminalHudObservation(
  lines: readonly string[]
): TerminalHudObservation | null {
  const floor = rowsUnderAgentInput(lines)
  for (let index = lines.length - 1; index >= floor; index -= 1) {
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
    // The FIRST word names the family. `includes` matched the word anywhere in
    // the bracket, so "docs/opus-migration-notes.md" read as Opus.
    const first = (words[0] ?? '').toLowerCase()
    const modelId = MODEL_FAMILIES.find((family) => first === family) ?? null
    if (!modelId) {
      continue
    }
    // The context figure sits after the badge on the same line, or on the line
    // below when the HUD wraps; the badge line wins when both carry one.
    const line = lines[index] ?? ''
    // A badge with no figure of its own may sit beside a status line that prints one as
    // `<used>/<window>` (claude-status-line-context.ts).
    const context =
      parseTerminalHudContextWindow(line.slice(match.index + match[0].length), {
        allowBarePercent: true
      }) ??
      parseTerminalHudContextWindow(lines[index + 1] ?? '') ??
      readClaudeStatusLineContext(lines)
    return {
      modelLabel,
      modelId,
      effort,
      context,
      ...activityField(lines),
      permissionMode: parseTerminalPermissionMode(lines),
      permissionModeSeen: readTerminalPermissionMode(lines),
      ...runningShellCountField(lines)
    }
  }
  // No status-line badge, but Claude Code's own footer is on screen: read the
  // context figure Claude Code paints itself once the window runs low. The
  // model is the screen's to state here only where the user's own status line
  // names it (below); else the beacon names it, or nothing.
  // The footer is known by its hint or by its mode row: the footers captured
  // with a shell running, in manual mode, or at 46 columns paint no whole
  // "shift+tab to cycle" (review, 2026-09-30). Over a footer known only by
  // its row, only Claude Code's own warning is read: a "context 54%" above
  // one may be conversation, and those footers were never read for a figure.
  // Codex's Plan hint is not Claude Code's: taken for it, a Codex footer with
  // no known agent lost its model, effort and Plan pill, and its "100% context
  // left" read as 100% used (review, 2026-09-30).
  // Only a row under the input box may state a figure in a status-line shape; above it, and on any
  // answer row, an answer's "about 45% context" set the ring (review, 2026-09-30), so there only
  // Claude Code's own warning is read, and never off the conversation. In fullscreen Claude Code
  // paints that warning right-aligned on the row above the box, which is indented like a reply row;
  // it is told apart by sitting flush with the box's right edge (claudeFullscreenNoticeRow), and
  // only the warning is read off it (2.1.295, 2026-10-09).
  // The model pair the user's own status line opens with (`Opus 5.5 xhigh │`, usage-band), read where
  // its figure is read and taken in the badge's place: the screen's pair, which the beacon does not
  // override (hud-beacon-fields.ts). The user's decision, 2026-10-09 (claude-status-line-context.ts).
  const pair = readClaudeStatusLineModel(lines)
  const hinted = lines.slice(-6).some((line) => CLAUDE_FOOTER.test(line.replace(CODEX_PLAN_HINT, '')))
  if (hinted || hasClaudeModeFooter(lines)) {
    // The user's own status line stating `<used>/<window>` outranks Claude Code's warning: it is the
    // session's own fraction, where the warning is measured to the compaction point and appears only
    // near the end (claude-status-line-context.ts; the user's decision, 2026-10-09).
    const stated = readClaudeStatusLine(lines)
    if (stated.kind === 'figure') {
      return claudeFooterObservation(lines, stated.context, pair)
    }
    // A figure the reader refused is not read by the looser patterns below either; Claude Code's own
    // warning still is.
    const refused = stated.kind === 'refused'
    const underBox = claudeRowsUnderInputBox(lines)
    const notice = claudeFullscreenNoticeRow(lines)
    for (let index = lines.length - 1; index >= Math.max(0, lines.length - 8); index -= 1) {
      const line = lines[index] ?? ''
      const under = underBox !== -1 && index >= underBox
      // The notice is the whole right-aligned text, so it OPENS with Claude Code's wording; a flush
      // tool-output row quoting it after other text is conversation (review, 2026-10-09).
      const isNotice = index === notice && CLAUDE_OWN_WARNING_START.test(line)
      if (!under && !isNotice && isClaudeConversationRow(line, underBox !== -1)) {
        continue
      }
      const context = parseTerminalHudContextWindow(line, { ownWarningOnly: refused || !hinted || !under })
      if (context) {
        return claudeFooterObservation(lines, context, pair)
      }
    }
  }
  // No Claude badge or figure on screen; try the Codex footer, which names a
  // model, and reads its own "context left" figures the right way round.
  const codex = parseCodexHudObservation(lines)
  if (codex || readTerminalPermissionMode(lines) === null) {
    return codex
  }
  // A bare Claude footer with no figure is still the footer: its mode and its
  // shell count are read, and the model and the ring are left blank. Returning
  // nothing here meant a host with no status line never had its mode read, so
  // the mode stepper pressed Shift+Tab six times on null reads and said the
  // mode was not available (review, 2026-09-30). Only a footer ROW counts
  // here, not the hint alone: "shift+tab to cycle" in the conversation would
  // otherwise state Manual over a footer nobody saw. That holds for the user's own status line too:
  // with no footer row its band is not read, so its pair cannot carry a Manual pill in with it
  // (review, 2026-10-09, five subagent rows pushing the mode row out of the footer's reach).
  return claudeFooterObservation(lines, null, pair)
}

/** Claude Code's own footer with no badge above it: the model and effort only where the user's own
 *  status line names them, else none. */
function claudeFooterObservation(
  lines: readonly string[],
  context: TerminalHudContextWindow | null,
  pair: ClaudeStatusLineModelPair | null = null
): TerminalHudObservation {
  return {
    modelLabel: pair?.modelLabel ?? '',
    modelId: pair?.modelId ?? null,
    effort: pair?.effort ?? null,
    context,
    ...activityField(lines),
    permissionMode: parseTerminalPermissionMode(lines),
    permissionModeSeen: readTerminalPermissionMode(lines),
    ...runningShellCountField(lines)
  }
}
