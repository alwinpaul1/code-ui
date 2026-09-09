import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'

/**
 * Fields a newer Orca host may put on `agentStatus` for the HUD: the effort
 * its Claude hook payload already carries, and the context tokens its
 * transcript reader already parses. Proposed upstream on 2026-09-09
 * (docs/orca-upstream-agent-status-usage.md). Until a host ships them they
 * are simply absent, and the HUD behaves exactly as before. Typed here rather
 * than in the vendored shared types, which are re-vendored, never edited.
 */
export type AgentStatusHudFields = {
  effort?: string
  contextUsedTokens?: number
  contextWindowTokens?: number
}

export function hudFieldsFromAgentStatus(
  status: AgentStatusEntry | null | undefined
): AgentStatusHudFields {
  const raw = (status ?? {}) as AgentStatusHudFields
  const fields: AgentStatusHudFields = {}
  if (typeof raw.effort === 'string' && raw.effort) {
    fields.effort = raw.effort
  }
  if (typeof raw.contextUsedTokens === 'number' && raw.contextUsedTokens >= 0) {
    fields.contextUsedTokens = raw.contextUsedTokens
  }
  if (typeof raw.contextWindowTokens === 'number' && raw.contextWindowTokens > 0) {
    fields.contextWindowTokens = raw.contextWindowTokens
  }
  return fields
}

/** "649.5k", "1.0M": the label the sheet prints beside the ring. Shared with
 *  the beacon merge so one formatter serves every source. */
export function shortTokenLabel(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`
  }
  if (tokens >= 1000) {
    const k = tokens / 1000
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`
  }
  return String(tokens)
}

/**
 * The host's figures outrank the screen: they come from the agent's own
 * record on every turn, not from text laid out for a column. A screen reading
 * fills whatever the host did not send. With tokens but no window size, no
 * percentage is stated (Claude Code never records its window); the sheet
 * shows the tokens used and says the rest is unknown.
 */
export function applyAgentStatusHudFields(
  screen: TerminalHudObservation | null,
  fields: AgentStatusHudFields
): TerminalHudObservation | null {
  const hasContext = fields.contextUsedTokens !== undefined
  if (!fields.effort && !hasContext) {
    return screen
  }
  const base: TerminalHudObservation =
    screen ?? { modelLabel: '', modelId: null, effort: null, context: null, permissionMode: 'default' }
  const context = hasContext
    ? fields.contextWindowTokens
      ? {
          usedPercent: Math.min(100, Math.round((fields.contextUsedTokens! / fields.contextWindowTokens) * 100)),
          usedLabel: shortTokenLabel(fields.contextUsedTokens!),
          windowLabel: shortTokenLabel(fields.contextWindowTokens),
          ...(base.context?.limits ? { limits: base.context.limits } : {})
        }
      : (base.context ?? null)
    : base.context
  return {
    ...base,
    effort: fields.effort ?? base.effort,
    context
  }
}
