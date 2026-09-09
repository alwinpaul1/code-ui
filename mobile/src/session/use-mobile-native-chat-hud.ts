import type { MutableRefObject } from 'react'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { RpcClient } from '../transport/rpc-client'
import { applyAgentStatusHudFields, hudFieldsFromAgentStatus } from './hud-agent-status-fields'
import { attachHudRateLimits, hudRateLimitsForAgent } from './hud-rate-limits'
import { useHostAccountsSnapshot } from './use-host-rate-limits'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'

/** The chat HUD, from two sources that need nothing set up on the host and
 *  open nothing there: the agent's own screen for the model, the effort, the
 *  context figure and the permission mode, and the host's `accounts.subscribe`
 *  for the rate-limit windows.
 *
 *  Known limit, by design: Claude Code paints its context figure only when a
 *  status line is installed, so on a bare host the Claude HUD shows the model
 *  and mode but no context ring. Codex paints all of it on its own footer.
 *  (A host-terminal reader that filled that gap was removed on 2026-09-09.) */
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
  const withHostFields = applyAgentStatusHudFields(
    screen.observation,
    hudFieldsFromAgentStatus(args.agentStatus)
  )
  return {
    ...screen,
    observation: attachHudRateLimits(withHostFields, hudRateLimitsForAgent(accounts, args.agent))
  }
}
