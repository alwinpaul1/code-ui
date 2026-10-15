import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CcrBranchPr } from './ccr-session-branch-status'
import type { CcrPillsReading } from './ccr-session-pills'
import type { PrSidebarState } from './mobile-pr-sidebar-state'
import type { MobileSessionController } from './use-mobile-session-controller'

// The reported gap of 2026-10-15: a work tab whose agent works outside the Orca worktree showed no
// pills, where the Claude app shows "Diff +11542 -3602" and "#12 • CI", or a purple "#1347 Merged".
// The pills now come from Anthropic's answer for the tab's Remote Control session when there is
// one, and are exactly what they were when there is not.

vi.mock('react-native', () => ({}))

const fake = vi.hoisted(() => ({
  ccr: null as unknown,
  ccrArgs: [] as Record<string, unknown>[],
  prInputs: [] as Record<string, unknown>[],
  branchArgs: [] as Record<string, unknown>[],
  prState: { kind: 'hidden' } as unknown
}))

vi.mock('./use-ccr-session-pills', () => ({
  useCcrSessionPills: (args: Record<string, unknown>) => {
    fake.ccrArgs.push(args)
    return fake.ccr
  }
}))
vi.mock('./use-session-branch-status', () => ({
  useSessionBranchStatus: (args: Record<string, unknown>) => {
    fake.branchArgs.push(args)
    return { status: { branch: 'feature/pills', head: 'abc', hasUpstream: true, ahead: 0, behind: 0 }, turnsEnded: 0 }
  }
}))
vi.mock('./use-mobile-pr-sidebar-controller', () => ({
  useMobilePrSidebarController: (input: Record<string, unknown>) => {
    fake.prInputs.push(input)
    return { prSidebarState: fake.prState, refetchPRSidebar: async () => {} }
  }
}))
vi.mock('../source-control/use-mobile-hosted-review-eligibility', () => ({
  useMobileHostedReviewEligibility: () => ({ kind: 'idle' })
}))

import type { SessionPill } from './session-pill-row-model'
import { useSessionPills } from './use-session-pills'

const CLAUDE_TRANSCRIPT = '/Users/me/.claude/projects/-Users-me-code-NexOS/6a1b0c2d-0000-4000-8000-000000000001.jsonl'
const CODEX_ROLLOUT = '/Users/me/.codex/sessions/2026/10/15/rollout-2026-10-15T08-00-00-6a1b0c2d-0000-4000-8000-000000000001.jsonl'

function claudePr(over: Partial<CcrBranchPr> = {}): CcrBranchPr {
  return {
    repo: 'nexdash/NexOS-Mobile',
    branch: 'claude/tablet-cab-redesign',
    sessionId: null,
    number: 12,
    state: 'open',
    url: 'https://github.com/nexdash/NexOS-Mobile/pull/12',
    ci: 'passed',
    additions: 11542,
    deletions: 3602,
    ...over
  }
}
const reading = (pr: CcrBranchPr | null): CcrPillsReading => ({ sessionId: 'cse_01QXaaaaaaaaaaaaaaaaaaaa', epoch: 7, pr, fetchedAt: 1 })

function controllerFor(identity: Record<string, unknown> | null = { sessionId: 'claude-session-1', transcriptPath: CLAUDE_TRANSCRIPT, nestedSessionId: null }, over: Record<string, unknown> = {}) {
  return {
    client: { id: 'client' },
    connState: 'connected',
    hostId: 'host-1',
    worktreeId: 'repo-1::/Users/me/code/NexOS',
    lastConnectedAt: 7,
    activeSessionTabId: 'tab-1',
    isFolderWorkspaceRoute: false,
    isFloatingWorkspaceRoute: false,
    prIsGithubRepo: true,
    prRepoContextLoaded: true,
    nativeChatController: { showNativeChat: true, nativeChatAgentWorking: false, nativeChatSessionIdentity: identity },
    ...over
  } as unknown as MobileSessionController
}

let shown: SessionPill[] = []
let renderer: ReactTestRenderer | null = null
function Harness(props: { controller: MobileSessionController }) {
  shown = useSessionPills(props.controller)
  return null
}
async function render(controller: MobileSessionController) {
  await act(async () => {
    renderer = create(createElement(Harness, { controller }))
  })
}

beforeEach(() => {
  fake.ccr = null
  fake.ccrArgs.length = 0
  fake.prInputs.length = 0
  fake.branchArgs.length = 0
  fake.prState = { kind: 'hidden' }
  shown = []
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('a tab whose session Anthropic reports a pull request for', () => {
  it('draws the Diff pill and the pull request pill, from Anthropic’s numbers', async () => {
    fake.ccr = reading(claudePr())
    await render(controllerFor())
    expect(shown).toMatchObject([
      { kind: 'diff', label: 'Diff', added: 11542, removed: 3602, url: 'https://github.com/nexdash/NexOS-Mobile/pull/12/files' },
      { kind: 'pull-request', number: 12, label: '#12', state: 'open', ci: 'passed', source: 'claude', url: 'https://github.com/nexdash/NexOS-Mobile/pull/12' }
    ])
  })

  it('draws a merged pull request as merged, with no CI part and no Diff pill when it has no lines', async () => {
    fake.ccr = reading(claudePr({ number: 1347, state: 'merged', ci: null, additions: 0, deletions: 0 }))
    await render(controllerFor())
    expect(shown).toMatchObject([{ kind: 'pull-request', number: 1347, state: 'merged', stateLabel: 'Merged', ci: null }])
    expect(shown).toHaveLength(1)
  })

  it('wins over Orca’s own pull request for the worktree, and Orca is not asked', async () => {
    fake.ccr = reading(claudePr())
    fake.prState = { kind: 'ready', data: { pr: { number: 7701, state: 'open', url: 'https://example.test/7701' }, details: null, checks: [], checksError: null } }
    await render(controllerFor())
    expect(shown.find((pill) => pill.kind === 'pull-request')).toMatchObject({ number: 12 })
    expect(fake.prInputs.at(-1)).toMatchObject({ client: null })
    expect(fake.branchArgs.at(-1)).toMatchObject({ enabled: false })
  })

  it('is read for a session that works outside the worktree, which hid Orca’s pills since 0.9.149', async () => {
    const elsewhere = '/Users/me/.claude/projects/-Users-me-code-NexOS-wt-tablet-cab-redesign/6a1b0c2d-0000-4000-8000-000000000001.jsonl'
    fake.ccr = reading(claudePr())
    await render(controllerFor({ sessionId: 'claude-session-1', transcriptPath: elsewhere, nestedSessionId: null }))
    expect(shown.map((pill) => pill.kind)).toEqual(['diff', 'pull-request'])
  })
})

describe('a tab Anthropic says nothing useful about', () => {
  it('keeps Orca’s pills when there is no reading (not matched, not signed in, a refused call)', async () => {
    fake.ccr = null
    fake.prState = {
      kind: 'ready',
      data: { pr: { number: 7701, title: 't', state: 'open', url: 'https://example.test/7701', checksStatus: 'success', updatedAt: 'x', mergeable: 'MERGEABLE' }, details: null, checks: [], checksError: null }
    }
    await render(controllerFor())
    expect(shown).toMatchObject([{ kind: 'pull-request', number: 7701 }])
    expect(shown[0]).not.toHaveProperty('source')
    expect(fake.prInputs.at(-1)!.client).not.toBeNull()
  })

  it('keeps Orca’s pills when Anthropic answered that the session has no pull request', async () => {
    fake.ccr = reading(null)
    fake.prState = { kind: 'none' } satisfies PrSidebarState
    await render(controllerFor())
    expect(shown).toEqual([])
    expect(fake.prInputs.at(-1)!.client).not.toBeNull()
  })

  it('shows nothing, as before 0.9.149, for an agent working elsewhere with no reading', async () => {
    const elsewhere = '/Users/me/.claude/projects/-Users-me-code-NexOS-wt-tablet-cab-redesign/6a1b0c2d-0000-4000-8000-000000000001.jsonl'
    await render(controllerFor({ sessionId: 's', transcriptPath: elsewhere, nestedSessionId: null }))
    expect(shown).toEqual([])
    expect(fake.prInputs.at(-1)).toMatchObject({ client: null })
  })
})

describe('when Anthropic is asked', () => {
  it('asks for the active tab’s Claude session on this connection, only for a Claude chat', async () => {
    await render(controllerFor())
    expect(fake.ccrArgs.at(-1)).toEqual({ enabled: true, tabId: 'tab-1', agentSessionId: 'claude-session-1', epoch: 7 })
  })

  it.each([
    ['a Codex chat', { sessionId: 'c', transcriptPath: CODEX_ROLLOUT, nestedSessionId: null }, {}],
    ['a chat with no transcript yet', null, {}],
    ['a tab that is not showing the chat', { sessionId: 's', transcriptPath: CLAUDE_TRANSCRIPT, nestedSessionId: null }, { showNativeChat: false }]
  ])('does not ask for %s', async (_name, identity, chat) => {
    const controller = controllerFor(identity)
    Object.assign((controller as unknown as { nativeChatController: Record<string, unknown> }).nativeChatController, chat)
    await render(controller)
    expect(fake.ccrArgs.at(-1)).toMatchObject({ enabled: false })
  })
})
