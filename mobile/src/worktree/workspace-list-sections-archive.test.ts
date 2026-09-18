import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { filterWorktrees, type Worktree } from './workspace-list-sections'

// Split out of workspace-list-sections.test.ts (max-lines): the "Archive a
// session" port (row #6 of the extension-port map) reuses that file's own
// worktree() fixture shape rather than a second one.
function worktree(overrides: Partial<Worktree> = {}): Worktree {
  const worktreePath = join('/tmp', 'orca', 'worktrees', 'feature')
  return {
    workspaceKind: 'git',
    worktreeId: `repo-1::${worktreePath}`,
    repoId: 'repo-1',
    repo: 'orca',
    branch: 'feature/mobile-parity',
    displayName: 'feature',
    path: worktreePath,
    liveTerminalCount: 0,
    hasAttachedPty: false,
    preview: '',
    unread: false,
    isPinned: false,
    linkedPR: null,
    status: 'inactive',
    agents: [],
    ...overrides
  }
}

function agentRow(overrides: Partial<RuntimeWorktreeAgentRow> = {}): RuntimeWorktreeAgentRow {
  return {
    paneKey: 'p',
    parentPaneKey: null,
    state: 'working',
    agentType: 'claude',
    prompt: '',
    taskTitle: null,
    displayName: null,
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

describe('showArchived — the "Archived" filter that brings a row back into view', () => {
  it('shows ONLY archived rows once switched on, not both', () => {
    const visible = worktree({ worktreeId: 'visible' })
    const archived = worktree({ worktreeId: 'archived', isArchived: true })

    expect(
      filterWorktrees(
        [visible, archived],
        { filterRepoIds: new Set(), hideSleeping: false, hideDefaultBranch: false, showArchived: true },
        ''
      )
    ).toEqual([archived])
  })

  it('is an empty list when nothing is archived', () => {
    const visible = worktree({ worktreeId: 'visible' })

    expect(
      filterWorktrees(
        [visible],
        { filterRepoIds: new Set(), hideSleeping: false, hideDefaultBranch: false, showArchived: true },
        ''
      )
    ).toEqual([])
  })

  it('still lists the last remaining worktree once it is the only archived one', () => {
    const archived = worktree({ worktreeId: 'lone', isArchived: true })

    expect(
      filterWorktrees(
        [archived],
        { filterRepoIds: new Set(), hideSleeping: false, hideDefaultBranch: false, showArchived: true },
        ''
      )
    ).toEqual([archived])
  })

  it('keeps an archived row that is still the active session — archiving does not force it out of view here', () => {
    const archivedActive = worktree({ worktreeId: 'active-archived', isArchived: true, isActive: true })

    expect(
      filterWorktrees(
        [archivedActive],
        { filterRepoIds: new Set(), hideSleeping: false, hideDefaultBranch: false, showArchived: true },
        ''
      )
    ).toEqual([archivedActive])
  })

  it('does not care which agent a row runs — Claude and Codex rows archive and filter the same way', () => {
    const claudeRow = worktree({
      worktreeId: 'claude-row',
      isArchived: true,
      agents: [agentRow({ paneKey: 'p1', agentType: 'claude' })]
    })
    const codexRow = worktree({
      worktreeId: 'codex-row',
      isArchived: true,
      agents: [agentRow({ paneKey: 'p2', agentType: 'codex' })]
    })

    expect(
      filterWorktrees(
        [claudeRow, codexRow],
        { filterRepoIds: new Set(), hideSleeping: false, hideDefaultBranch: false, showArchived: true },
        ''
      )
    ).toEqual([claudeRow, codexRow])
  })
})
