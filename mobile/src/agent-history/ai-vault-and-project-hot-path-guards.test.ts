// Guards for two more shared hot paths the phone runs, after the allocation
// work in Orca #19469 (063c1caa6) and #19465 (2c5cd845a). Both are pure
// refactors: the answers below are the answers before them too.
//
// They live under mobile/ because `src/shared/*.test.ts` is vendored and never
// runs here — vitest is rooted at mobile/ — so upstream's own tests for these
// commits cannot guard anything in this fork. The project projection is
// consumed by `mobile/src/components/new-workspace-project-targets.ts`; it
// shares a file with the vault filters because both landed in one commit.

import { describe, expect, it } from 'vitest'
import {
  filterAiVaultSessions,
  type AiVaultSessionFilterState
} from '../../../src/shared/ai-vault-session-filters'
import {
  aiVaultSessionDepthCovers,
  requestedAiVaultSessionDepth
} from '../../../src/shared/ai-vault-session-depth'
import { projectHostSetupProjectionFromRepos } from '../../../src/shared/project-host-setup-projection'
import type { AiVaultSession } from '../../../src/shared/ai-vault-types'
import type { Repo } from '../../../src/shared/repo-types'

function session(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'claude:1',
    executionHostId: 'local',
    agent: 'claude',
    sessionId: 'session-1',
    title: 'Implement vault filters',
    cwd: '/Users/ada/repo/app',
    branch: 'feature/vault',
    model: 'claude-sonnet-4-5',
    filePath: '/Users/ada/.claude/projects/session-1.jsonl',
    codexHome: null,
    createdAt: '2026-06-28T23:00:00.000Z',
    updatedAt: '2026-06-28T23:55:00.000Z',
    modifiedAt: '2026-06-28T23:55:00.000Z',
    messageCount: 4,
    totalTokens: 1200,
    previewMessages: [{ role: 'user', text: 'add the scope tabs', timestamp: null }],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: '',
    subagent: null,
    ...overrides
  }
}

function filters(overrides: Partial<AiVaultSessionFilterState> = {}): AiVaultSessionFilterState {
  return {
    query: '',
    // An empty agent list matches nothing, so the default here is every agent
    // the fixtures use.
    agents: ['claude', 'codex'],
    scope: 'all',
    sort: 'recent',
    activeWorktreePaths: [],
    hideEmptySessions: false,
    ...overrides
  }
}

function repo(overrides: Partial<Repo> & Pick<Repo, 'id' | 'path' | 'displayName'>): Repo {
  return { badgeColor: '#737373', addedAt: 100, kind: 'git', ...overrides }
}

describe('searching the agent history', () => {
  const sessions = [
    session({ id: 'a', title: 'Implement vault filters' }),
    session({ id: 'b', title: 'Rename the composer', cwd: '/Users/ada/other/app' }),
    session({ id: 'c', title: 'Fix the picker', agent: 'codex' })
  ]

  it('matches on a plain term', () => {
    const found = filterAiVaultSessions(sessions, filters({ query: 'picker' }))
    expect(found.map((entry) => entry.id)).toEqual(['c'])
  })

  it('matches on a path term', () => {
    const found = filterAiVaultSessions(sessions, filters({ query: 'path:other' }))
    expect(found.map((entry) => entry.id)).toEqual(['b'])
  })

  it('narrows to the agents the user asked for', () => {
    const found = filterAiVaultSessions(sessions, filters({ agents: ['codex'] }))
    expect(found.map((entry) => entry.id)).toEqual(['c'])
  })

  it('refuses a query too large to be a search', () => {
    const found = filterAiVaultSessions(sessions, filters({ query: 'x'.repeat(4096) }))
    expect(found).toEqual([])
  })
})

describe('how deep a vault scan went', () => {
  it('defaults when the caller named no limit', () => {
    expect(requestedAiVaultSessionDepth()).toBe(1000)
    expect(requestedAiVaultSessionDepth({ limit: 50 })).toBe(50)
    expect(requestedAiVaultSessionDepth({ unlimited: true })).toBe('unlimited')
  })

  it('reuses a cached scan only when it went at least as deep', () => {
    expect(aiVaultSessionDepthCovers(200, 50)).toBe(true)
    expect(aiVaultSessionDepthCovers(50, 200)).toBe(false)
    expect(aiVaultSessionDepthCovers('unlimited', 200)).toBe(true)
    expect(aiVaultSessionDepthCovers(200, 'unlimited')).toBe(false)
  })
})

describe('a project built from several repos', () => {
  it('keeps every source repo that fed it, once each', () => {
    const first = repo({
      id: 'repo-1',
      path: '/Users/ada/one',
      displayName: 'orca',
      upstream: { owner: 'acme', repo: 'orca' }
    })
    const second = repo({
      id: 'repo-2',
      path: '/Users/ada/two',
      displayName: 'orca',
      upstream: { owner: 'acme', repo: 'orca' }
    })
    const projection = projectHostSetupProjectionFromRepos([first, second, first])
    expect(projection.projects).toHaveLength(1)
    expect(projection.projects[0]!.sourceRepoIds).toEqual(['repo-1', 'repo-2'])
    expect(projection.setups).toHaveLength(3)
  })

  it('never writes back onto the repo rows it was given', () => {
    const source = repo({ id: 'repo-1', path: '/Users/ada/one', displayName: 'orca' })
    const before = JSON.stringify(source)
    projectHostSetupProjectionFromRepos([source, source])
    expect(JSON.stringify(source)).toBe(before)
  })
})
