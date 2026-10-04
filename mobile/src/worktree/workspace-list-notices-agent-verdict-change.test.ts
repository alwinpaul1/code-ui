import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import type { Worktree } from './workspace-list-sections'
import { areWorktreeListsEqual } from './worktree-list-snapshot'
import { agentDotState } from './agent-row-display'

// The sidebar's agent dot reads `mainAgent` (the display layer of Orca #22944), and the host
// catalog keeps its previous list whenever the snapshot reads equal
// (use-host-worktree-catalog.ts: `areWorktreeListsEqual(current, confirmed) ? current :
// confirmed`). A snapshot that never compared `mainAgent` kept the old list, so a main agent that
// failed, or a verdict that changed, left the old dot on screen. The first three cases are
// upstream's own (#22944, 85067494a1, worktree-list-snapshot.test.ts); the last follows the kept
// list through to the dot the sidebar draws.

function agent(overrides: Partial<RuntimeWorktreeAgentRow> = {}): RuntimeWorktreeAgentRow {
  return {
    paneKey: 'agent-1',
    parentPaneKey: null,
    state: 'working',
    agentType: 'claude',
    prompt: 'fix mobile lag',
    taskTitle: null,
    displayName: null,
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: 100,
    updatedAt: 200,
    ...overrides
  }
}

function done(
  outcome: 'success' | 'failure' | 'cancellation',
  stateStartedAt = 1
): NonNullable<RuntimeWorktreeAgentRow['mainAgent']> {
  return { state: 'done', outcome, stateStartedAt }
}

function worktree(agents: RuntimeWorktreeAgentRow[]): Worktree {
  const worktreePath = join('/tmp', 'orca', 'worktrees', 'manta')
  return {
    worktreeId: `repo-1::${worktreePath}`,
    repoId: 'repo-1',
    repo: 'orca',
    branch: 'feature/mobile-lag',
    displayName: 'manta',
    workspaceStatus: 'in-progress',
    path: worktreePath,
    liveTerminalCount: 1,
    hasAttachedPty: true,
    preview: '$ claude',
    unread: false,
    lastOutputAt: 1234,
    isPinned: false,
    isActive: false,
    linkedPR: null,
    linkedIssue: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    comment: '',
    status: 'active',
    agents
  }
}

/** What use-host-worktree-catalog.ts keeps: the current list when the snapshot reads equal. */
function kept(current: Worktree[], confirmed: Worktree[]): Worktree[] {
  return areWorktreeListsEqual(current, confirmed) ? current : confirmed
}

describe('the workspace list notices a verdict change on an agent row', () => {
  it('detects a verdict change that leaves the interrupted flag as it was', () => {
    const first = [worktree([agent({ state: 'done', mainAgent: done('success') })])]
    const second = [worktree([agent({ state: 'done', mainAgent: done('failure') })])]
    expect(areWorktreeListsEqual(first, second)).toBe(false)
  })

  it('detects a main agent failing while its subagents keep the row working', () => {
    const first = [worktree([agent({ state: 'working' })])]
    const second = [worktree([agent({ state: 'working', mainAgent: done('failure') })])]
    expect(areWorktreeListsEqual(first, second)).toBe(false)
  })

  it('detects the main agent clock moving, which dates a failure', () => {
    const at = (stateStartedAt: number) => [
      worktree([agent({ state: 'working', mainAgent: done('failure', stateStartedAt) })])
    ]
    expect(areWorktreeListsEqual(at(1), at(2))).toBe(false)
    expect(areWorktreeListsEqual(at(1), at(1))).toBe(true)
  })

  it('draws the dot the host now reports, not the one the kept list had', () => {
    const current = [worktree([agent({ state: 'working' })])]
    const confirmed = [worktree([agent({ state: 'working', mainAgent: done('failure') })])]
    const shown = kept(current, confirmed)[0]!.agents![0]!
    // The confirmed row reads failed (a fault outranks live subagent work)...
    expect(agentDotState(confirmed[0]!.agents![0]!, 300)).toBe('failed')
    // ...and that is what the sidebar must draw.
    expect(agentDotState(shown, 300)).toBe('failed')
  })
})
