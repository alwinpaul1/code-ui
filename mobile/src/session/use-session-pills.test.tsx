import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PRInfo } from '../../../src/shared/github/pull-request-types'
import type { MobileHostedReviewEligibilityReply } from '../source-control/hosted-review-reply-schema'
import type { MobileCreatePrEligibilityState } from '../source-control/mobile-create-pr-action'
import type { PrSidebarState } from './mobile-pr-sidebar-state'
import type { SessionBranchStatus } from './use-session-branch-status'
import type { MobileSessionController } from './use-mobile-session-controller'

// The session pills are fed by three reads Orca already answers for the source-control screen:
// git.status (which branch, which commit, whether it has a remote branch), the pull request read
// for that branch, and the host's review-creation eligibility. This pins how the hook wires them:
// what each is asked, when each is asked again, and that nothing is asked where no pill can show.

vi.mock('react-native', () => ({}))

const fake = vi.hoisted(() => ({
  status: null as SessionBranchStatus | null,
  turnsEnded: 0,
  branchArgs: [] as Record<string, unknown>[],
  prState: { kind: 'hidden' } as unknown,
  prInputs: [] as Record<string, unknown>[],
  refetch: vi.fn(async (_options?: { includeDetails?: boolean }) => {}),
  eligibility: { kind: 'idle' } as unknown,
  eligibilityInputs: [] as Record<string, unknown>[]
}))

vi.mock('./use-session-branch-status', () => ({
  useSessionBranchStatus: (args: Record<string, unknown>) => {
    fake.branchArgs.push(args)
    return { status: fake.status, turnsEnded: fake.turnsEnded }
  }
}))
vi.mock('./use-mobile-pr-sidebar-controller', () => ({
  useMobilePrSidebarController: (input: Record<string, unknown>) => {
    fake.prInputs.push(input)
    return { prSidebarState: fake.prState, refetchPRSidebar: fake.refetch }
  }
}))
vi.mock('../source-control/use-mobile-hosted-review-eligibility', () => ({
  useMobileHostedReviewEligibility: (input: Record<string, unknown>) => {
    fake.eligibilityInputs.push(input)
    return fake.eligibility
  }
}))

import type { SessionPill } from './session-pill-row-model'
import { useSessionPills } from './use-session-pills'

const CLIENT = { id: 'client' }

function pr(over: Partial<PRInfo> = {}): PRInfo {
  return {
    number: 7701,
    title: 'Pills',
    state: 'open',
    url: 'https://example.test/pr/7701',
    checksStatus: 'success',
    updatedAt: '2026-07-07T00:00:00Z',
    mergeable: 'MERGEABLE',
    ...over
  }
}
/** The host's reply the way the schema publishes it: every member written out, stated or not. */
function reply(over: { canCreate?: boolean; blockedReason?: string | null }): MobileHostedReviewEligibilityReply {
  return {
    provider: 'github',
    canCreate: undefined,
    blockedReason: undefined,
    nextAction: undefined,
    reviewLookupOutcome: undefined,
    defaultBaseRef: undefined,
    title: undefined,
    body: undefined,
    ...over
  }
}
const READY: PrSidebarState = {
  kind: 'ready',
  data: { pr: pr(), details: null, checks: [], checksError: null }
}
const BRANCH: SessionBranchStatus = {
  branch: 'feature/pills',
  head: 'abc123',
  hasUpstream: true,
  ahead: 0,
  behind: 0
}

function controllerFor(over: Record<string, unknown> = {}, chat: Record<string, unknown> = {}) {
  return {
    client: CLIENT,
    connState: 'connected',
    hostId: 'host-1',
    worktreeId: 'repo-1::/work/a',
    lastConnectedAt: 7,
    isFolderWorkspaceRoute: false,
    isFloatingWorkspaceRoute: false,
    prIsGithubRepo: true,
    prRepoContextLoaded: true,
    nativeChatController: { showNativeChat: true, nativeChatAgentWorking: false, ...chat },
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
    const element = createElement(Harness, { controller })
    if (renderer) {
      renderer.update(element)
    } else {
      renderer = create(element)
    }
  })
}

const lastOf = (list: Record<string, unknown>[]) => list.at(-1)!

beforeEach(() => {
  fake.status = BRANCH
  fake.turnsEnded = 0
  fake.branchArgs.length = 0
  fake.prState = READY
  fake.prInputs.length = 0
  fake.refetch.mockClear()
  fake.eligibility = { kind: 'idle' }
  fake.eligibilityInputs.length = 0
  shown = []
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('the pills for a branch with a pull request', () => {
  it('draws the pull request pill, asking for the branch and commit git.status gave', async () => {
    await render(controllerFor())
    expect(shown).toMatchObject([{ kind: 'pull-request', number: 7701, label: '#7701' }])
    expect(lastOf(fake.prInputs)).toMatchObject({
      client: CLIENT,
      connState: 'connected',
      worktreeId: 'repo-1::/work/a',
      branch: 'feature/pills',
      headSha: 'abc123',
      lastConnectedAt: 7
    })
  })

  it('does not ask the host about creating a review while one exists', async () => {
    await render(controllerFor())
    expect(lastOf(fake.eligibilityInputs).branch).toBeUndefined()
  })
})

describe('the pills for a branch with no pull request', () => {
  beforeEach(() => {
    fake.prState = { kind: 'none' }
  })

  it('asks the host about the branch, from its remote state and not its work tree', async () => {
    fake.status = { ...BRANCH, hasUpstream: false, ahead: 0, behind: 0 }
    fake.eligibility = {
      kind: 'ready',
      eligibility: reply({ canCreate: false, blockedReason: 'no_upstream' })
    } satisfies MobileCreatePrEligibilityState
    await render(controllerFor())
    expect(lastOf(fake.eligibilityInputs)).toMatchObject({
      client: CLIENT,
      connState: 'connected',
      hostId: 'host-1',
      worktreeId: 'repo-1::/work/a',
      branch: 'feature/pills',
      hasUpstream: false,
      ahead: 0,
      behind: 0,
      hasUncommittedChanges: false
    })
    expect(shown).toMatchObject([{ kind: 'local-changes' }])
  })

  it('draws Create PR when the host says the branch can open one', async () => {
    fake.eligibility = { kind: 'ready', eligibility: reply({ canCreate: true }) }
    await render(controllerFor())
    expect(shown).toEqual([{ kind: 'create-pr', label: 'Create PR' }])
  })

  it('draws nothing while the host has not answered, or answered with an error', async () => {
    await render(controllerFor())
    expect(shown).toEqual([])
    fake.eligibility = { kind: 'error' }
    await render(controllerFor())
    expect(shown).toEqual([])
  })
})

describe('where no pill can show, nothing is asked', () => {
  it.each([
    ['a repo with no hosted-review remote', { prIsGithubRepo: false }],
    ['a repo whose remote has not been probed yet', { prRepoContextLoaded: false }],
    ['a folder workspace', { isFolderWorkspaceRoute: true }],
    ['the floating terminal workspace', { isFloatingWorkspaceRoute: true }]
  ])('on %s: no client for the pull request read, no branch for the host, no git.status', async (_n, over) => {
    fake.prState = { kind: 'none' }
    await render(controllerFor(over))
    expect(shown).toEqual([])
    expect(lastOf(fake.prInputs).client).toBeNull()
    expect(lastOf(fake.eligibilityInputs).branch).toBeUndefined()
    expect(lastOf(fake.branchArgs).enabled).toBe(false)
    expect(fake.refetch).not.toHaveBeenCalled()
  })

  it('reads nothing while the chat is not on screen (a terminal or file tab draws no pills)', async () => {
    await render(controllerFor({}, { showNativeChat: false }))
    expect(lastOf(fake.branchArgs).enabled).toBe(false)
  })

  it('draws nothing, and asks for no pull request, before git.status has named a branch', async () => {
    fake.status = null
    fake.prState = { kind: 'hidden' }
    await render(controllerFor())
    expect(shown).toEqual([])
    expect(lastOf(fake.prInputs).branch).toBeNull()
    expect(fake.refetch).not.toHaveBeenCalled()
  })

  it('draws nothing for a detached HEAD, which names no branch', async () => {
    fake.status = { ...BRANCH, branch: null }
    fake.prState = { kind: 'hidden' }
    await render(controllerFor())
    expect(shown).toEqual([])
    expect(fake.refetch).not.toHaveBeenCalled()
  })
})

describe('when the pull request is read again', () => {
  it('loads it once the branch is known and nothing is loaded, checks and PR only (no comments)', async () => {
    fake.prState = { kind: 'hidden' }
    await render(controllerFor())
    expect(fake.refetch).toHaveBeenCalledTimes(1)
    expect(fake.refetch).toHaveBeenCalledWith({ includeDetails: false })
    // Same state, same branch: a re-render is not a reason to ask again.
    await render(controllerFor())
    expect(fake.refetch).toHaveBeenCalledTimes(1)
  })

  it('reads it again when the agent finishes a turn, which is when it may have opened one', async () => {
    await render(controllerFor())
    expect(fake.refetch).not.toHaveBeenCalled()
    fake.turnsEnded = 1
    await render(controllerFor())
    expect(fake.refetch).toHaveBeenCalledTimes(1)
    expect(fake.refetch).toHaveBeenCalledWith({ includeDetails: false })
    await render(controllerFor())
    expect(fake.refetch).toHaveBeenCalledTimes(1)
  })

  it('does not read it at a turn end on a repo with no hosted-review remote', async () => {
    await render(controllerFor({ prIsGithubRepo: false }))
    fake.turnsEnded = 1
    await render(controllerFor({ prIsGithubRepo: false }))
    expect(fake.refetch).not.toHaveBeenCalled()
  })
})

// Reported 2026-10-15 on 0.9.148: a hand-started `claude --resume` in an Orca tab of the NexOS
// worktree (branch fix/demo-adr-422, repo parth2600/nexdash) worked in another checkout,
// /Users/alwinpaul/Desktop/NexOS-Mobile-wt/tablet-cab-redesign (branch feat/tablet-cab-redesign,
// NexOS-Mobile, PR #12 open). The pills read git.status and the PR for the ORCA worktree, so the
// chat showed "Create PR" over a session the Claude app showed with "#12 • CI". The ids and paths
// are the real ones (the tab from `orca terminal list`, the transcript path the hook reported).
describe('a chat whose agent works outside the Orca worktree', () => {
  const NEXOS_WORKTREE = '6abb2731-479f-4ffd-ab34-200a1daa7eb4::/Users/alwinpaul/Desktop/NexDash/NexOS'
  const ELSEWHERE_TRANSCRIPT =
    '/Users/alwinpaul/.claude-work/projects/-Users-alwinpaul-Desktop-NexOS-Mobile-wt-tablet-cab-redesign/e50745d9-3b6f-4381-9e9c-48cfb838fa5f.jsonl'
  const HERE_TRANSCRIPT =
    '/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-NexDash-NexOS/e50745d9-3b6f-4381-9e9c-48cfb838fa5f.jsonl'
  const identity = (transcriptPath: string | null) => ({
    nativeChatSessionIdentity: { sessionId: 'e50745d9-3b6f-4381-9e9c-48cfb838fa5f', transcriptPath, nestedSessionId: null }
  })

  beforeEach(() => {
    fake.status = { ...BRANCH, branch: 'fix/demo-adr-422' }
    fake.prState = { kind: 'none' }
    fake.eligibility = { kind: 'ready', eligibility: reply({ canCreate: true }) }
  })

  it('shows no Create PR for the worktree’s branch when the session works in another checkout, and reads nothing for it', async () => {
    await render(controllerFor({ worktreeId: NEXOS_WORKTREE }, identity(ELSEWHERE_TRANSCRIPT)))
    expect(shown).toEqual([])
    expect(lastOf(fake.branchArgs).enabled).toBe(false)
    expect(lastOf(fake.prInputs).client).toBeNull()
    expect(fake.refetch).not.toHaveBeenCalled()
  })

  it('shows no pull request pill of the worktree’s branch either', async () => {
    fake.prState = READY
    await render(controllerFor({ worktreeId: NEXOS_WORKTREE }, identity(ELSEWHERE_TRANSCRIPT)))
    expect(shown).toEqual([])
  })

  it('still shows the pills when the session works in the worktree itself', async () => {
    await render(controllerFor({ worktreeId: NEXOS_WORKTREE }, identity(HERE_TRANSCRIPT)))
    expect(shown).toEqual([{ kind: 'create-pr', label: 'Create PR' }])
  })

  it('keeps today’s pills while no transcript has been reported (nothing says where the agent is)', async () => {
    await render(controllerFor({ worktreeId: NEXOS_WORKTREE }, identity(null)))
    expect(shown).toEqual([{ kind: 'create-pr', label: 'Create PR' }])
  })
})
