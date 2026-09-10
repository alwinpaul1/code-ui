const agentsByWorktree = new Map<string, readonly string[]>()

export function setWorktreeLaunchAgents(worktreeId: string, agents: readonly string[]): void {
  const unique = [...new Set(agents.filter((agent) => agent.length > 0))]
  if (unique.length === 0) {
    agentsByWorktree.delete(worktreeId)
    return
  }
  agentsByWorktree.set(worktreeId, unique)
}

/** The one launched agent on this worktree, or null when none or more than one. */
export function uniqueWorktreeLaunchAgent(worktreeId: string | undefined): string | null {
  if (!worktreeId) {
    return null
  }
  const agents = agentsByWorktree.get(worktreeId)
  return agents?.length === 1 ? (agents[0] ?? null) : null
}

export function resetWorktreeLaunchAgentsForTests(): void {
  agentsByWorktree.clear()
}
