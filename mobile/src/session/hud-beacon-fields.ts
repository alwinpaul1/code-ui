import type { AgentHudBeacon } from './agent-hud-beacon'
import { shortTokenLabel } from './hud-agent-status-fields'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'

/**
 * The beacon outranks every other HUD source for context, and for the model
 * and effort wherever the screen names no model.
 *
 * It is not a reading of anything: it is what the agent said about itself, on
 * the turn it said it, straight out of Claude Code's status-line payload or
 * Codex's own rollout. The screen still owns the permission and collaboration
 * modes, which are footer state no beacon carries.
 *
 * The screen is the present. A live beacon and the badge on the user's own
 * status line describe the same repaint and cannot disagree for longer than
 * the instant after `/model`. When they do disagree, the beacon is describing
 * something that is no longer on screen: on 2026-09-18 the phone said "Fable
 * 5.1 medium" over a screen that painted "[Opus 5 (1M context) xhigh]",
 * because the beacon was the last word of a process that had exited and the
 * hand-started `claude -c` in its place emits none. So a badge that names a
 * model owns the pair — model, name and effort, null included — and the
 * beacon supplies the rest. Codex's own footer names its model too and is
 * read the same way.
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
  // The badge on screen names a model: the pair is its, whole. `base.modelId`
  // is only ever the screen's — `applyAgentStatusHudFields` sets effort and
  // context, never a model — so this cannot be the launch record winning back.
  if (base.modelId !== null) {
    return { ...base, context }
  }
  // A beacon naming no model is the Stop hook talking about running tasks
  // and says nothing about either half, so there the base stands.
  const beaconNamesModel = beacon.modelId !== null || beacon.modelLabel !== null
  return {
    ...base,
    // The id and the NAME are one statement about one session, so they fall
    // back together. Falling back independently kept the previous id beside a
    // new name (or the reverse), and the pill stated a pair that never existed
    // — the same defect as "Opus Medium" on an Opus xhigh session, one field
    // over. A beacon that names a model either way owns both halves.
    ...(beaconNamesModel
      ? { modelLabel: beacon.modelLabel ?? beacon.modelId ?? '', modelId: beacon.modelId }
      : { modelLabel: base.modelLabel, modelId: base.modelId }),
    // A beacon that NAMES a model speaks for the effort beside it too, null
    // included. Falling back to the base was how a launch-time effort got
    // welded onto a model the agent had since switched to: the merge order puts
    // `agentStatus` in first, so `base.effort` is the launch value, and the pair
    // was already mixed before `useStickyLiveHud` could hold the two together
    // ("Opus Medium" on an Opus xhigh session, 2026-09-15).
    effort: beaconNamesModel ? beacon.effort : base.effort,
    context
  }
}

/**
 * True when this beacon belongs to the tab being drawn: the agent it names is
 * the tab's, and the session it names is the one the tab is showing.
 *
 * A tab's handle is its own, but the process under it changes — a `/model`, a
 * `/clear`, a new agent typed into the same terminal after the last one
 * exited — and the beacon store is keyed by that handle. So neither the agent
 * name nor the session is trusted from the tab record; both are checked
 * against what the beacon itself says.
 *
 * Three refusals, all "show nothing rather than a figure from elsewhere":
 *  - the beacon names another session: it is not this process;
 *  - the beacon names no session while the tab knows its own: an older
 *    emitter or an older record, and no evidence it is this process;
 *  - the tab does not yet know its session: the beacon is held, unused, until
 *    it does.
 */
export function agentHudBeaconMatches(
  beacon: Pick<AgentHudBeacon, 'agent' | 'sessionId'> | null,
  agent: string | null,
  sessionId: string | null
): boolean {
  if (!beacon || !agentHudBeaconSpeaksFor(beacon, sessionId)) {
    return false
  }
  if (!agent) {
    return true
  }
  // Orca labels an OpenClaude tab 'openclaude'; Claude Code names itself claude.
  return agent === beacon.agent || (agent === 'openclaude' && beacon.agent === 'claude')
}

/** The session half of `agentHudBeaconMatches`, for readers that have no
 *  agent name to check (the tab strip's dot). Same three refusals. */
export function agentHudBeaconSpeaksFor(
  beacon: Pick<AgentHudBeacon, 'sessionId'>,
  sessionId: string | null
): boolean {
  return sessionId !== null && beacon.sessionId === sessionId
}
