/**
 * Picks the terminal `/mcp` should type into, from a `session.tabs.list`
 * reply for the worktree. Looks for the first terminal tab whose agent
 * status names Claude Code and is idle — the same idle/agent gate as
 * `canShowMcpStatusOverlay` in mcp-status-overlay.ts, applied here to
 * whichever candidate this reads off the wire instead of trusting a caller
 * to have already worked it out.
 *
 * This is a best-effort, one-shot read done when the MCP servers screen
 * opens (not a live subscription) — the screen may go stale if the terminal
 * starts a turn while it stays open; see the panel's own note on this.
 * Returns null on anything it cannot confidently read rather than guessing
 * at a terminal handle to type into.
 */
export type McpStatusTerminalCandidate = {
  terminal: string
  agent: string | null
  status: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function findMcpStatusTerminalCandidate(
  sessionTabsListResult: unknown
): McpStatusTerminalCandidate | null {
  if (!isRecord(sessionTabsListResult) || !Array.isArray(sessionTabsListResult.tabs)) {
    return null
  }
  for (const raw of sessionTabsListResult.tabs) {
    if (!isRecord(raw) || raw.type !== 'terminal') {
      continue
    }
    const terminal = readString(raw.terminal)
    if (!terminal) {
      continue
    }
    const agentStatus = isRecord(raw.agentStatus) ? raw.agentStatus : null
    const hookAgentType = readString(agentStatus?.agentType)
    const agent =
      (hookAgentType && hookAgentType !== 'unknown' ? hookAgentType : null) ??
      readString(raw.launchAgent)
    const status = readString(agentStatus?.state)
    if (agent === 'claude' && status === 'done') {
      return { terminal, agent, status }
    }
  }
  return null
}
