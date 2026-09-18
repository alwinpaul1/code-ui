import type { MutableRefObject } from 'react'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { RpcClient } from '../transport/rpc-client'
import { useAgentHudBeacon, type AgentHudBeacon } from './agent-hud-beacon'
import type { BeaconPhase } from './agent-hud-beacon-liveness'
import { applyAgentStatusHudFields, hudFieldsFromAgentStatus } from './hud-agent-status-fields'
import { agentHudBeaconMatches, applyAgentHudBeaconFields } from './hud-beacon-fields'
import { attachHudRateLimits, hudRateLimitsForAgent } from './hud-rate-limits'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'
import { useAgentHudBeaconLiveness } from './use-agent-hud-beacon-liveness'
import { useHostAccountsSnapshot } from './use-host-rate-limits'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'
import { useStickyLiveHud } from './use-sticky-live-hud'

export type NativeChatHudPhase = BeaconPhase

/** What the agent is doing, for the poll cadence and the beacon's clock.
 *  `paused` — a dialog or a question up — polls like working but is not a
 *  turn end; nor is `interrupted`, a `done` Orca marks as a cancellation,
 *  which the agent reports no turn end for. See `agent-hud-beacon-liveness.ts`. */
export function nativeChatHudPhase(
  working: boolean,
  state: AgentStatusEntry['state'] | null | undefined,
  interrupted: boolean | null | undefined
): NativeChatHudPhase {
  if (working) {
    return 'working'
  }
  if (state === 'blocked' || state === 'waiting') {
    return 'paused'
  }
  return state === 'done' && interrupted === true ? 'interrupted' : 'idle'
}

/** The pair and context the HUD states, or nothing — see the hook. */
export type NativeChatLiveHud = {
  model: string | null
  label: string | null
  effort: string | null
  context: TerminalHudObservation['context']
}

/** The chat HUD, from sources that need nothing set up on the host, open
 *  nothing there, and draw nothing in the user's terminal:
 *
 *  - the agent's screen: the permission and collaboration modes, and the
 *    `[Model effort]` badge of a user's own status line (or Codex's footer).
 *    The screen is the present: a badge that names a model owns the pair.
 *  - the agent's own state, on the invisible OSC 7777 beacon it writes to its
 *    PTY when the phone launched it (`agent-hud-beacon.ts`): the context, and
 *    the model and effort where the screen names none. Believed only for the
 *    session the tab is showing, and only while its process still speaks —
 *    a beacon is keyed by terminal handle, and a handle outlives the process
 *    that emitted into it (2026-09-18: "Fable 5.1 medium" on a hand-started
 *    `claude -c` painting Opus). A phone-launched Claude beacons on a timer
 *    while it works, so working silence is death; Codex beacons only at a
 *    turn's end, so only a turn end it did not report is
 *    (`agent-hud-beacon-liveness.ts`).
 *  - a newer host's `agentStatus` fields, when it forwards them.
 *  - the host's `accounts.subscribe` for the rate-limit windows.
 *
 *  The screen's model pair and context are held across empty screen reads
 *  (`useStickyLiveHud`), and the hold is applied to the raw screen reading
 *  BEFORE the beacon is merged in, so nothing a beacon said is ever held past
 *  the moment the store lets it go. */
export function useMobileNativeChatHud(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  scopeKey: string | null
  /** The tab and the session it is showing; both key the screen hold, and the
   *  session decides which beacon may be believed. */
  tabId: string | null
  sessionId: string | null
  agent: string | null
  /** What the agent is doing, from Orca's status: the poll cadence and the
   *  beacon's clock both follow it. */
  phase: NativeChatHudPhase
  /** The tab's agent status from Orca; a newer host puts effort and context tokens on it. */
  agentStatus?: AgentStatusEntry | null
}): ReturnType<typeof useMobileTerminalHudObservation> & {
  /** The beacon the merge believed, for readers of its other fields (desktop
   *  prompts, running tasks); null when none may be believed. */
  liveBeacon: AgentHudBeacon | null
  /** The model pair and context of `observation`, in the shape the pill and
   *  the ring read. Nothing here comes from the launch record. */
  live: NativeChatLiveHud
} {
  const screen = useMobileTerminalHudObservation({
    client: args.client,
    enabled: args.enabled,
    handleRef: args.handleRef,
    handleKey: args.scopeKey,
    agent: args.agent,
    active: args.phase === 'working' || args.phase === 'paused'
  })
  const accounts = useHostAccountsSnapshot(args.client, args.enabled)
  // Read at render: a new beacon re-renders through the store, and a handle
  // swap re-renders through `scopeKey`, so the ref is never read stale here.
  const handle = args.handleRef.current
  const beacon = useAgentHudBeacon(handle)
  const painting = useAgentHudBeaconLiveness({ handle, listening: args.enabled, phase: args.phase, beacon })
  const liveBeacon =
    painting && agentHudBeaconMatches(beacon, args.agent, args.sessionId) ? beacon : null
  const hostFields = hudFieldsFromAgentStatus(args.agentStatus)
  const rateLimits = hudRateLimitsForAgent(accounts, args.agent)
  const merge = (base: TerminalHudObservation | null) =>
    attachHudRateLimits(
      applyAgentHudBeaconFields(applyAgentStatusHudFields(base, hostFields), liveBeacon),
      rateLimits
    )
  // `observation` is this tick's screen with the beacon merged in, as every
  // reader of the footer state (permission mode, agent mode, shell count)
  // has always had it: an empty read is an empty read there.
  const observation = merge(screen.observation)
  // The pill and the ring read the same merge over the HELD screen instead:
  // the badge's last pair and context for this tab, terminal and session, so
  // an empty read does not blank them.
  const held = useStickyLiveHud(screen.observation, args.tabId, handle, args.sessionId)
  const heldScreen: TerminalHudObservation | null =
    held.model === null && held.context === null
      ? screen.observation
      : {
          modelLabel: '',
          effort: null,
          permissionMode: 'default',
          ...screen.observation,
          modelId: held.model,
          ...(held.model !== null ? { modelLabel: held.label ?? '', effort: held.effort } : {}),
          context: held.context
        }
  const live = merge(heldScreen)
  return {
    ...screen,
    observation,
    liveBeacon,
    live: {
      model: live?.modelId ?? null,
      label: live?.modelLabel || null,
      effort: live?.effort ?? null,
      context: live?.context ?? null
    }
  }
}
