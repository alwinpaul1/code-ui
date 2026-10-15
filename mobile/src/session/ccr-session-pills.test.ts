import { beforeEach, describe, expect, it } from 'vitest'
import { setCcrMapping } from './ccr-session-cache'
import { CCR_PILLS_FRESH_MS, ccrPillsForTab, ccrPillsVersion, forgetCcrPills, refreshCcrPills, resetCcrPillsForTests } from './ccr-session-pills'
import { resetCcrPipelineForTests, type CcrPipelineDeps } from './ccr-session-pipeline'
import {
  NEXOS_BRANCH,
  NEXOS_REPO,
  branchFetch,
  branchStatus,
  branchStatusReply,
  jsonReply,
  pullRequest,
  rowWithBranches
} from './fixtures/ccr-branch-status-2026-10-15'
import { ACCOUNT_UUID, ORG_UUID, SESSION_A, SESSION_B, TOKEN, defaultAccount, fakeAccounts } from './fixtures/ccr-session-api-2026-10-14'

const TAB = 'tab-1'

function harness(args: { rows?: unknown[]; reply?: () => ReturnType<typeof jsonReply>; token?: string | null }) {
  const { fetch, requests } = branchFetch({
    sessions: args.rows ?? [rowWithBranches(SESSION_A)],
    branchStatus: args.reply ?? (() => jsonReply(200, branchStatusReply([branchStatus()])))
  })
  const kept = fakeAccounts(args.token === null ? [] : [defaultAccount({ token: args.token ?? TOKEN, organizationUuid: ORG_UUID })])
  const lines: { line: string; ok: boolean }[] = []
  const deps: CcrPipelineDeps = {
    fetch,
    accounts: kept.source,
    keep: () => '',
    maxBytes: 1,
    log: (line, ok) => lines.push({ line, ok })
  }
  return { deps, requests, lines }
}

beforeEach(() => {
  resetCcrPipelineForTests()
  resetCcrPillsForTests()
  setCcrMapping(TAB, SESSION_A, 1, ACCOUNT_UUID)
})

describe('the pull request kept for a matched tab', () => {
  it('is read with the matched account’s token and organization, and kept for the tab', async () => {
    const h = harness({})
    await refreshCcrPills(TAB, 1, h.deps)
    const post = h.requests.find((request) => request.method === 'POST')!
    expect(post.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(post.headers['X-Organization-Uuid']).toBe(ORG_UUID)
    expect(post.body).toMatchObject({
      session_id: SESSION_A,
      repo_branches: [{ repo: NEXOS_REPO, branch: NEXOS_BRANCH }]
    })
    expect(ccrPillsForTab(TAB, 1)).toMatchObject({ sessionId: SESSION_A, epoch: 1, pr: { number: 12, state: 'open', ci: 'passed', additions: 11542, deletions: 3602 } })
    expect(h.lines.at(-1)).toMatchObject({ ok: true })
    expect(h.lines.at(-1)!.line).not.toContain(TOKEN)
  })

  it('costs one list and one branch-status request, the list shared with the model’s read', async () => {
    const h = harness({})
    await refreshCcrPills(TAB, 1, h.deps)
    expect(h.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /v1/code/sessions',
      'POST /v1/code/github/get-batch-branch-status'
    ])
  })

  it('does nothing, and asks nothing, for a tab not matched on this connection', async () => {
    const h = harness({})
    await refreshCcrPills('tab-unmatched', 1, h.deps)
    await refreshCcrPills(TAB, 2, h.deps)
    expect(h.requests).toEqual([])
    expect(ccrPillsForTab('tab-unmatched', 1)).toBeNull()
  })

  it('keeps an answer of "no pull request" as an answer, not as nothing', async () => {
    const h = harness({ reply: () => jsonReply(200, branchStatusReply([branchStatus({ pull_request: null })])) })
    await refreshCcrPills(TAB, 1, h.deps)
    expect(ccrPillsForTab(TAB, 1)).toMatchObject({ pr: null })
  })

  it('shows a merged pull request as merged once the next read says so, replacing the open one', async () => {
    let state = 'OPEN'
    const h = harness({ reply: () => jsonReply(200, branchStatusReply([branchStatus({ pull_request: pullRequest({ state }) })])) })
    await refreshCcrPills(TAB, 1, h.deps)
    expect(ccrPillsForTab(TAB, 1)?.pr?.state).toBe('open')
    state = 'MERGED'
    await refreshCcrPills(TAB, 1, { ...h.deps, fetch: branchFetch({ sessions: [rowWithBranches(SESSION_A)], branchStatus: () => jsonReply(200, branchStatusReply([branchStatus({ pull_request: pullRequest({ state }) })])) }).fetch })
    expect(ccrPillsForTab(TAB, 1)?.pr).toMatchObject({ state: 'merged', ci: null })
  })

  it('is not used once older than its freshness, nor from another connection', async () => {
    const h = harness({})
    await refreshCcrPills(TAB, 1, h.deps)
    const fetchedAt = ccrPillsForTab(TAB, 1)!.fetchedAt
    expect(ccrPillsForTab(TAB, 1, fetchedAt + CCR_PILLS_FRESH_MS)).not.toBeNull()
    expect(ccrPillsForTab(TAB, 1, fetchedAt + CCR_PILLS_FRESH_MS + 1)).toBeNull()
    expect(ccrPillsForTab(TAB, 2, fetchedAt)).toBeNull()
  })

  it('tells the screens when a reading is kept and when it is dropped', async () => {
    const h = harness({})
    const before = ccrPillsVersion()
    await refreshCcrPills(TAB, 1, h.deps)
    expect(ccrPillsVersion()).toBeGreaterThan(before)
    const kept = ccrPillsVersion()
    forgetCcrPills(TAB)
    expect(ccrPillsVersion()).toBeGreaterThan(kept)
    forgetCcrPills(TAB)
    expect(ccrPillsVersion()).toBe(kept + 1)
  })
})

describe('when the read fails the tab keeps what it had, and says why in one line', () => {
  it.each([
    ['the sign-in refused', 401, 'the sign-in was refused'],
    ['the endpoint refused the sign-in’s scope', 403, 'forbidden'],
    ['the endpoint not there', 404, 'not found'],
    ['a server error', 500, 'HTTP 500']
  ])('on %s the last reading stays and the line names the cause', async (_name, status, words) => {
    const h = harness({})
    await refreshCcrPills(TAB, 1, h.deps)
    const failing = harness({ reply: () => jsonReply(status, { error: 'x' }) })
    await refreshCcrPills(TAB, 1, failing.deps)
    expect(ccrPillsForTab(TAB, 1)?.pr?.number).toBe(12)
    expect(failing.lines.at(-1)).toMatchObject({ ok: false })
    expect(failing.lines.at(-1)!.line).toContain(words)
    expect(failing.lines.at(-1)!.line).not.toContain(TOKEN)
  })

  it('never reaches a pill from a reply that is the wrong shape', async () => {
    const h = harness({ reply: () => jsonReply(200, { branch_statuses: 'none' }) })
    await refreshCcrPills(TAB, 1, h.deps)
    expect(ccrPillsForTab(TAB, 1)).toBeNull()
    expect(h.lines.at(-1)).toMatchObject({ ok: false })
    expect(h.lines.at(-1)!.line).toContain('not the expected shape')
  })

  it('drops the reading and says so when the matched account is signed out', async () => {
    const h = harness({})
    await refreshCcrPills(TAB, 1, h.deps)
    const out = harness({ token: null })
    await refreshCcrPills(TAB, 1, out.deps)
    expect(ccrPillsForTab(TAB, 1)).toBeNull()
    expect(out.lines.at(-1)!.line).toContain('no longer signed in')
  })

  it('drops the reading when the session is no longer in the account’s list', async () => {
    const h = harness({})
    await refreshCcrPills(TAB, 1, h.deps)
    const gone = harness({ rows: [rowWithBranches(SESSION_B)] })
    await refreshCcrPills(TAB, 1, gone.deps)
    expect(ccrPillsForTab(TAB, 1)).toBeNull()
    expect(gone.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('drops the reading when the account has no usable token', async () => {
    const h = harness({})
    await refreshCcrPills(TAB, 1, h.deps)
    const kept = fakeAccounts([defaultAccount({ token: null, organizationUuid: ORG_UUID, error: 'expired' })])
    await refreshCcrPills(TAB, 1, { ...h.deps, accounts: kept.source })
    expect(ccrPillsForTab(TAB, 1)).toBeNull()
  })
})
