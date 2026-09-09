import type { AgentHudBeacon } from './agent-hud-beacon'
import { shortTokenLabel } from './hud-agent-status-fields'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'

/**
 * The beacon outranks every other HUD source for model, effort and context.
 *
 * It is not a reading of anything: it is what the agent said about itself, on
 * the turn it said it, straight out of Claude Code's status-line payload or
 * Codex's own rollout. The screen still owns the permission and collaboration
 * modes, which are footer state no beacon carries.
 *
 * Nothing here derives a denominator. A beacon that states a window gets a
 * percentage; a beacon that states only tokens leaves the context alone,
 * because the ring the phone draws is a fraction and there is no honest one to
 * draw. Claude Code reports `context_window_size` and Codex reports
 * `model_context_window`, so that case needs no invention today.
 */
export function applyAgentHudBeaconFields(
  screen: TerminalHudObservation | null,
  beacon: AgentHudBeacon | null
): TerminalHudObservation | null {
  if (!beacon) {
    return screen
  }
  const base: TerminalHudObservation = screen ?? {
    modelLabel: '',
    modelId: null,
    effort: null,
    context: null,
    permissionMode: 'default'
  }
  const used = beacon.usedTokens
  const window = beacon.windowTokens
  const context =
    used !== null && window !== null && window > 0
      ? {
          usedPercent: Math.max(
            0,
            Math.min(100, beacon.usedPercent ?? Math.round((used / window) * 100))
          ),
          usedLabel: shortTokenLabel(used),
          windowLabel: shortTokenLabel(window),
          ...(beacon.limits.length > 0
            ? { limits: beacon.limits.map((limit) => ({ ...limit, windowMinutes: null })) }
            : base.context?.limits
              ? { limits: base.context.limits }
              : {})
        }
      : base.context
  return {
    ...base,
    modelLabel: beacon.modelLabel ?? beacon.modelId ?? base.modelLabel,
    modelId: beacon.modelId ?? base.modelId,
    effort: beacon.effort ?? base.effort,
    context
  }
}

/** True when this beacon belongs to the tab being drawn. A tab's handle is its
 *  own, but the agent can change under it (a `/model`, a new session), so the
 *  agent name is checked too rather than trusted from the tab record. */
export function agentHudBeaconMatches(
  beacon: AgentHudBeacon | null,
  agent: string | null
): boolean {
  if (!beacon) {
    return false
  }
  if (!agent) {
    return true
  }
  // Orca labels an OpenClaude tab 'openclaude'; Claude Code names itself claude.
  return agent === beacon.agent || (agent === 'openclaude' && beacon.agent === 'claude')
}
