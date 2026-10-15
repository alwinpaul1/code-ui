import { describe, expect, it } from 'vitest'
import { CcrApiError, listCcrSessions } from './ccr-session-api'
import { branchPrOf, CCR_BRANCH_STATUS_URL, ciRollup, fetchCcrBranchPr, pickBranchPr } from './ccr-session-branch-status'
import {
  NEXOS_BRANCH,
  NEXOS_REPO,
  branchFetch,
  branchStatus,
  branchStatusReply,
  checkRun,
  jsonReply,
  pullRequest,
  rowWithBranches,
  statusContext
} from './fixtures/ccr-branch-status-2026-10-15'
import { ORG_UUID, SESSION_A, TOKEN } from './fixtures/ccr-session-api-2026-10-14'

// The Claude app asks for a session's pull request, its CI and its diff totals in one POST
// (`v1/code/github/get-batch-branch-status`). The shapes are the app's (see the fixture's header);
// no live capture exists yet, so what the parser does not recognise is no pill rather than a guess.

const auth = { token: TOKEN, organizationUuid: ORG_UUID }
const pairs = [{ repo: NEXOS_REPO, branch: NEXOS_BRANCH }]

describe('the request for a session’s pull request', () => {
  it('posts the session’s branches with discovery and CI on, with the app’s headers', async () => {
    const { fetch, requests } = branchFetch({ sessions: [], branchStatus: () => jsonReply(200, branchStatusReply([])) })
    await fetchCcrBranchPr(fetch, auth, { sessionId: SESSION_A, pairs })
    expect(requests).toEqual([
      {
        url: CCR_BRANCH_STATUS_URL,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Anthropic-Version': '2023-06-01',
          'Anthropic-Beta': 'ccr-byoc-2025-07-29',
          'X-Organization-Uuid': ORG_UUID,
          'Anthropic-Client-Platform': 'android',
          'Content-Type': 'application/json'
        },
        body: {
          repo_branches: [{ repo: NEXOS_REPO, branch: NEXOS_BRANCH }],
          session_id: SESSION_A,
          discover_session_prs: true,
          include_ci_status: true
        }
      }
    ])
    expect(CCR_BRANCH_STATUS_URL).toBe('https://api.anthropic.com/v1/code/github/get-batch-branch-status')
  })

  it('still asks, for discovery, when the row names no branch (the empty list)', async () => {
    const { fetch, requests } = branchFetch({ sessions: [], branchStatus: () => jsonReply(200, branchStatusReply([])) })
    await fetchCcrBranchPr(fetch, auth, { sessionId: SESSION_A, pairs: [] })
    expect((requests[0]!.body as { repo_branches: unknown[] }).repo_branches).toEqual([])
  })

  it('fails with the stage and the reason, never the body, when the call is refused', async () => {
    for (const [status, reason] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not-found'],
      [500, 'http']
    ] as const) {
      const { fetch } = branchFetch({ sessions: [], branchStatus: () => jsonReply(status, { error: 'secret detail' }) })
      const error = await fetchCcrBranchPr(fetch, auth, { sessionId: SESSION_A, pairs }).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(CcrApiError)
      expect(error).toMatchObject({ stage: 'branches', reason, status })
      expect(String(error)).not.toContain('secret')
    }
  })

  it('fails as malformed for a reply with no branch_statuses list', async () => {
    const { fetch } = branchFetch({ sessions: [], branchStatus: () => jsonReply(200, { statuses: [] }) })
    await expect(fetchCcrBranchPr(fetch, auth, { sessionId: SESSION_A, pairs })).rejects.toMatchObject({ stage: 'branches', reason: 'malformed' })
  })
})

describe('the branches a session row names', () => {
  const list = async (row: Record<string, unknown>) => {
    const { fetch } = branchFetch({ sessions: [row], branchStatus: () => jsonReply(200, branchStatusReply([])) })
    return (await listCcrSessions(fetch, auth, { cursor: null, limit: 50 })).sessions[0]!.branches
  }

  it('are the current branches first and the outcomes’ branches after, each pair once', async () => {
    const row = rowWithBranches(SESSION_A, {
      external_metadata: { current_branches: { [NEXOS_REPO]: NEXOS_BRANCH, 'nexdash/other': 'main' } },
      config: {
        outcomes: [
          { type: 'git_repository', git_info: { type: 'github', repo: NEXOS_REPO, branches: [NEXOS_BRANCH, 'claude/older'] } }
        ]
      }
    })
    await expect(list(row)).resolves.toEqual([
      { repo: NEXOS_REPO, branch: NEXOS_BRANCH },
      { repo: 'nexdash/other', branch: 'main' },
      { repo: NEXOS_REPO, branch: 'claude/older' }
    ])
  })

  it.each([
    ['no config and no metadata', { config: undefined, external_metadata: undefined }],
    ['an empty branch and a non-string one', { external_metadata: { current_branches: { [NEXOS_REPO]: '', other: 7 } }, config: {} }],
    ['outcomes that are not a list', { config: { outcomes: 'git' }, external_metadata: {} }],
    ['an outcome with no git_info', { config: { outcomes: [{ type: 'unknown' }] }, external_metadata: {} }]
  ])('are none for %s', async (_name, overrides) => {
    await expect(list(rowWithBranches(SESSION_A, overrides))).resolves.toEqual([])
  })
})

describe('the pull request a branch status carries', () => {
  it('reads an open pull request with its number, URL and diff totals', () => {
    expect(branchPrOf(branchStatus())).toEqual({
      repo: NEXOS_REPO,
      branch: NEXOS_BRANCH,
      sessionId: null,
      number: 12,
      state: 'open',
      url: 'https://github.com/nexdash/NexOS-Mobile/pull/12',
      ci: 'passed',
      additions: 11542,
      deletions: 3602
    })
  })

  it.each([
    ['DRAFT', 'draft', 'passed'],
    ['Open', 'open', 'passed'],
    ['CLOSED', 'closed', 'passed'],
    ['merged', 'merged', null],
    ['QUEUED', 'queued', null]
  ])('reads the state word %s case-blind as %s, with CI %s (a merged or queued PR has no CI part)', (word, state, ci) => {
    expect(branchPrOf(branchStatus({ pull_request: pullRequest({ state: word }) }))).toMatchObject({ state, ci })
  })

  it.each([
    ['an unknown state word', { state: 'ABANDONED' }],
    ['no state', { state: undefined }],
    ['a state that is not text', { state: 3 }],
    ['a number that is not an integer', { number: 12.5 }],
    ['a zero number', { number: 0 }],
    ['a number that is text', { number: '12' }]
  ])('refuses %s: no pill rather than a guess', (_name, overrides) => {
    expect(branchPrOf(branchStatus({ pull_request: pullRequest(overrides) }))).toBeNull()
  })

  it('has no pull request for a branch status without one, or with a null one', () => {
    expect(branchPrOf(branchStatus({ pull_request: undefined }))).toBeNull()
    expect(branchPrOf(branchStatus({ pull_request: null }))).toBeNull()
    expect(branchPrOf('nope')).toBeNull()
    expect(branchPrOf(null)).toBeNull()
  })

  it('opens github.com/<repo>/pull/<n> when the pull request names no URL, as the app does', () => {
    expect(branchPrOf(branchStatus({ pull_request: pullRequest({ url: undefined }) }))?.url).toBe(`https://github.com/${NEXOS_REPO}/pull/12`)
    expect(branchPrOf(branchStatus({ pull_request: pullRequest({ url: '' }) }))?.url).toBe(`https://github.com/${NEXOS_REPO}/pull/12`)
  })

  it('counts a missing or invalid total as zero, so a bad number never reaches the Diff pill', () => {
    expect(branchPrOf(branchStatus({ pull_request: pullRequest({ additions: undefined, deletions: -4 }) }))).toMatchObject({ additions: 0, deletions: 0 })
    expect(branchPrOf(branchStatus({ pull_request: pullRequest({ additions: 1.5, deletions: '9' }) }))).toMatchObject({ additions: 0, deletions: 0 })
  })
})

describe('the CI dot, rolled up as the app rolls it (t130.n)', () => {
  it('is failed when any check fails, whatever else is pending or passed', () => {
    expect(ciRollup([checkRun('SUCCESS'), checkRun('FAILURE'), checkRun(null, 'IN_PROGRESS')], 'open')).toBe('failed')
  })

  it.each(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'failure'])('is failed for a check run concluded %s', (conclusion) => {
    expect(ciRollup([checkRun(conclusion)], 'open')).toBe('failed')
  })

  it('is passed when nothing is pending and one check passed, neutral ones aside', () => {
    expect(ciRollup([checkRun('SUCCESS'), checkRun('NEUTRAL'), checkRun('SKIPPED')], 'open')).toBe('passed')
  })

  it('is pending for an open or draft PR with a check still running, and unavailable for a closed one', () => {
    const running = [checkRun('SUCCESS'), checkRun(null, 'IN_PROGRESS')]
    expect(ciRollup(running, 'open')).toBe('pending')
    expect(ciRollup(running, 'draft')).toBe('pending')
    expect(ciRollup(running, 'closed')).toBe('unavailable')
  })

  it('treats a check run that is not completed as pending, whatever its conclusion field says', () => {
    expect(ciRollup([checkRun('SUCCESS', 'QUEUED')], 'open')).toBe('pending')
  })

  it('reads a status context by its state: SUCCESS passes, FAILURE and ERROR fail, the rest wait', () => {
    expect(ciRollup([statusContext('SUCCESS')], 'open')).toBe('passed')
    expect(ciRollup([statusContext('FAILURE')], 'open')).toBe('failed')
    expect(ciRollup([statusContext('ERROR')], 'open')).toBe('failed')
    expect(ciRollup([statusContext('PENDING')], 'open')).toBe('pending')
    expect(ciRollup([statusContext('EXPECTED')], 'open')).toBe('pending')
  })

  it('is unavailable with no checks at all (a list that is empty, absent or not a list)', () => {
    expect(ciRollup([], 'open')).toBe('unavailable')
    expect(ciRollup(undefined, 'open')).toBe('unavailable')
    expect(ciRollup('checks', 'open')).toBe('unavailable')
    expect(ciRollup([null, 7], 'open')).toBe('unavailable')
  })

  it('is unavailable when only neutral checks exist: they say nothing about passing', () => {
    expect(ciRollup([checkRun('NEUTRAL'), checkRun('CANCELLED')], 'open')).toBe('unavailable')
  })
})

describe('which branch status is the session’s', () => {
  const other = branchStatus({ repo: 'nexdash/other', branch: 'main', pull_request: pullRequest({ number: 99 }) })

  it('is the status of the first of the session’s own branches that has a pull request', () => {
    const reply = branchStatusReply([other, branchStatus()])
    expect(pickBranchPr(reply, pairs)?.number).toBe(12)
  })

  it('never takes a pull request of a branch the session does not name', () => {
    expect(pickBranchPr(branchStatusReply([other]), pairs)).toBeNull()
  })

  it('matches the repo without regard to case, as the app does, and the branch exactly', () => {
    const reply = branchStatusReply([branchStatus({ repo: NEXOS_REPO.toUpperCase() })])
    expect(pickBranchPr(reply, pairs)?.number).toBe(12)
    expect(pickBranchPr(branchStatusReply([branchStatus({ branch: NEXOS_BRANCH.toUpperCase() })]), pairs)).toBeNull()
  })

  it('takes a pull request the server attributes to the session when the row names no branch', () => {
    const attributed = branchStatus({ session_id: SESSION_A })
    expect(pickBranchPr(branchStatusReply([other, attributed]), [], SESSION_A)?.number).toBe(12)
    expect(pickBranchPr(branchStatusReply([attributed]), [], 'cse_01QXzzzzzzzzzzzzzzzzzzzz')).toBeNull()
  })

  it('is none for a reply with no statuses (the degenerate size)', () => {
    expect(pickBranchPr(branchStatusReply([]), pairs)).toBeNull()
    expect(pickBranchPr(branchStatusReply([]), [])).toBeNull()
  })

  it('skips a status that is malformed and reads the next', () => {
    const reply = branchStatusReply(['junk', { repo: NEXOS_REPO }, branchStatus()])
    expect(pickBranchPr(reply, pairs)?.number).toBe(12)
  })
})
