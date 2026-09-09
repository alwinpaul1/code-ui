import type { MutableRefObject } from 'react'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { RpcClient } from '../transport/rpc-client'
import { useAgentHudBeacon } from './agent-hud-beacon'
import { applyAgentStatusHudFields, hudFieldsFromAgentStatus } from './hud-agent-status-fields'
import { agentHudBeaconMatches, applyAgentHudBeaconFields } from './hud-beacon-fields'
import { attachHudRateLimits, hudRateLimitsForAgent } from './hud-rate-limits'
import { useHostAccountsSnapshot } from './use-host-rate-limits'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'

/** The chat HUD, from sources that need nothing set up on the host, open
 *  nothing there, and draw nothing in the user's terminal:
 *
 *  - the agent's own state, on the invisible OSC 7777 beacon it writes to its
 *    PTY when the phone launched it (`agent-hud-beacon.ts`). Highest priority:
 *    Claude Code and Codex are describing themselves, live.
 *  - a newer host's `agentStatus` fields, when it forwards them.
 *  - the agent's screen, for the permission and collaboration modes, and as
 *    the fallback model/context reading on a tab with no beacon (one the user
 *    started on the desktop before turning the launch profile on).
 *  - the host's `accounts.subscribe` for the rate-limit windows.
 */
export function useMobileNativeChatHud(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  scopeKey: string | null
  agent: string | null
  active: boolean
  /** The tab's agent status from Orca; a newer host puts effort and context tokens on it. */
  agentStatus?: AgentStatusEntry | null
}) {
  const screen = useMobileTerminalHudObservation({
    client: args.client,
    enabled: args.enabled,
    handleRef: args.handleRef,
    handleKey: args.scopeKey,
    agent: args.agent,
    active: args.active
  })
  const accounts = useHostAccountsSnapshot(args.client, args.enabled)
  // Read at render: a new beacon re-renders through the store, and a handle
  // swap re-renders through `scopeKey`, so the ref is never read stale here.
  const beacon = useAgentHudBeacon(args.handleRef.current)
  const withHostFields = applyAgentStatusHudFields(
    screen.observation,
    hudFieldsFromAgentStatus(args.agentStatus)
  )
  const withBeacon = applyAgentHudBeaconFields(
    withHostFields,
    agentHudBeaconMatches(beacon, args.agent) ? beacon : null
  )
  return {
    ...screen,
    observation: attachHudRateLimits(withBeacon, hudRateLimitsForAgent(accounts, args.agent))
  }
}
