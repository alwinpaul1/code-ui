import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { ccrMappedSessionForTab } from '../session/ccr-session-cache'
import { ccrSessionFactsForAgent, type CcrSessionFacts } from '../session/ccr-session-facts'
import { orcaClaudeSessionState, type ClaudeSessionState } from '../session/claude-session-state'
import { agentDotState, type AgentDotState } from './agent-row-display'

/** The tab's Anthropic session facts for a Claude agent row, only while fresh, newer than Orca's
 *  row, and about the session the tab is matched to now (ccr-session-facts.ts). Null for every
 *  other agent. */
export function claudeAgentSessionFacts(agent: RuntimeWorktreeAgentRow, now: number): CcrSessionFacts | null {
  return agent.agentType === 'claude' ? ccrSessionFactsForAgent(agent, now, ccrMappedSessionForTab) : null
}

/**
 * A Claude agent row's session state (claude-session-state.ts), which its status dot on the
 * workspace list follows. It is read by Orca's own status while that says the agent is busy or waiting
 * (Orca hears the agent live; the session row is up to a minute old), and otherwise by its tab's
 * Anthropic session row while the phone holds one that still applies (`claudeAgentSessionFacts`),
 * which tells Ready for review from Completed and names a turn that ended needing input. With no
 * such row, Orca's status decides. Only Claude agents get one: a Codex or untyped agent is null.
 */
export function claudeAgentSessionState(agent: RuntimeWorktreeAgentRow, now: number): ClaudeSessionState | null {
  if (agent.agentType !== 'claude') {
    return null
  }
  const dot = agentDotState(agent, now)
  const orca = orcaClaudeSessionState(dot)
  if (dot === 'working' || dot === 'monitoring' || dot === 'waiting' || dot === 'blocked') {
    return orca
  }
  return claudeAgentSessionFacts(agent, now)?.state ?? orca
}

/** A Claude agent row's dot: Orca's, unless the session state above says Working or Needs input
 *  where Orca's dot does not. A Codex or untyped row keeps Orca's dot untouched. */
export function claudeAgentDotState(agent: RuntimeWorktreeAgentRow, now: number): AgentDotState {
  const dot = agentDotState(agent, now)
  const state = claudeAgentSessionState(agent, now)
  if (state === 'working' && dot !== 'working' && dot !== 'monitoring') {
    return 'working'
  }
  if (state === 'needs-input' && dot !== 'waiting' && dot !== 'blocked' && dot !== 'failed') {
    return 'waiting'
  }
  return dot
}

/** A workspace whose agents are all Claude sessions (at least one): its status glyph follows the
 *  theme. One Codex agent among them keeps the desktop hues. */
export function isClaudeOnlyWorkspace(agents: readonly RuntimeWorktreeAgentRow[] | undefined): boolean {
  return agents !== undefined && agents.length > 0 && agents.every((agent) => agent.agentType === 'claude')
}
