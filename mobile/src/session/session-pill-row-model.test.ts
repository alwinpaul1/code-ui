import { describe, expect, it, vi } from 'vitest'
import type { PRCheckDetail } from '../../../src/shared/github/check-types'
import type { PRInfo } from '../../../src/shared/github/pull-request-types'
import type { MobileHostedReviewEligibilityReply } from '../source-control/hosted-review-reply-schema'
import type { MobileCreatePrEligibilityState } from '../source-control/mobile-create-pr-action'
import type { PrSidebarState } from './mobile-pr-sidebar-state'
import {
  LOCAL_CHANGES_HINT,
  LOCAL_CHANGES_HINT_MAX_WIDTH,
  buildClaudeSessionPills,
  buildSessionPills,
  sessionCiSpoken,
  sessionPillActions
} from './session-pill-row-model'

/**
 * The session pills the Claude Android app draws above its composer (com.anthropic.claude
 * 1.261009.20): `jc20.q` is the pull request pill (number, with the CI status inside it, or the
 * state word for a merged PR), `bsu` case 0 is Create PR, `bsu` case 2 with `jc20.g` is Local
 * changes and its hint. The user removed the Diff pill Orca's numbers fed on 2026-10-12; the one
 * that is here (`jc20.p`) is built only from Anthropic's pull request (buildClaudeSessionPills).
 * Every other pill is fed by what Orca answered; with no answer there is no pill.
 */

function pr(overrides: Partial<PRInfo> = {}): PRInfo {
  return {
    number: 7701,
    title: 'Make center split more visible',
    state: 'open',
    url: 'https://example.test/pr/7701',
    checksStatus: 'success',
    updatedAt: '2026-07-07T00:00:00Z',
    mergeable: 'MERGEABLE',
    ...overrides
  }
}

function check(
  conclusion: PRCheckDetail['conclusion'],
  status: PRCheckDetail['status'] = 'completed'
): PRCheckDetail {
  return { name: `check-${conclusion}-${status}`, status, conclusion, url: null }
}

function ready(
  prInfo: PRInfo,
  checks: PRCheckDetail[],
  checksError: string | null = null
): PrSidebarState {
  return { kind: 'ready', data: { pr: prInfo, checks, details: null, checksError } }
}

const NO_REVIEW: MobileCreatePrEligibilityState = { kind: 'idle' }

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

function eligible(over: {
  canCreate?: boolean
  blockedReason?: string | null
}): MobileCreatePrEligibilityState {
  return { kind: 'ready', eligibility: reply(over) }
}

function build(
  state: PrSidebarState,
  eligibility: MobileCreatePrEligibilityState = NO_REVIEW,
  over: { hosted?: boolean; branch?: string | null } = {}
) {
  return buildSessionPills({
    hosted: over.hosted ?? true,
    branch: over.branch === undefined ? 'feature/pills' : over.branch,
    pr: state,
    eligibility
  })
}

describe('the pull request pill', () => {
  it.each([
    ['open', 'Open', 'success'],
    ['draft', 'Draft', 'muted'],
    ['closed', 'Closed', 'danger'],
    ['merged', 'Merged', 'merged']
  ] as const)('says "#N" and tints a %s pull request by its state', (state, stateLabel, tint) => {
    const [pill] = build(ready(pr({ state }), [check('success')]))
    expect(pill).toMatchObject({
      kind: 'pull-request',
      number: 7701,
      label: '#7701',
      state,
      stateLabel,
      tint,
      spoken: 'Pull request #7701'
    })
  })

  it('opens the pull request the host named, and carries its url for a copy or a share', () => {
    const [pill] = build(ready(pr({ url: 'https://example.test/pr/9' }), []))
    expect(pill).toMatchObject({ kind: 'pull-request', url: 'https://example.test/pr/9' })
  })
})

describe('the CI status inside the pull request pill', () => {
  it('reads a failing check as "CI: checks failing" even beside passing ones', () => {
    const [pill] = build(ready(pr(), [check('success'), check('failure')]))
    expect(pill).toMatchObject({ ci: 'failed' })
    expect(sessionCiSpoken('failed')).toBe('CI: checks failing')
  })

  it('reads a check still running as "CI: checks in progress"', () => {
    const [pill] = build(ready(pr(), [check('success'), check(null, 'in_progress')]))
    expect(pill).toMatchObject({ ci: 'pending' })
    expect(sessionCiSpoken('pending')).toBe('CI: checks in progress')
  })

  it('reads all green, a skipped job counted as passing, as "CI: all checks passed"', () => {
    const [pill] = build(ready(pr(), [check('success'), check('skipped')]))
    expect(pill).toMatchObject({ ci: 'passed' })
    expect(sessionCiSpoken('passed')).toBe('CI: all checks passed')
  })

  it('reads a checks read that failed as "CI: status unavailable", never as a pass', () => {
    const [pill] = build(ready(pr(), [], 'checks read timed out'))
    expect(pill).toMatchObject({ ci: 'unavailable' })
    expect(sessionCiSpoken('unavailable')).toBe('CI: status unavailable')
  })

  it('reads checks that resolved to nothing actionable as unavailable too', () => {
    const [pill] = build(ready(pr(), [check('neutral')]))
    expect(pill).toMatchObject({ ci: 'unavailable' })
  })

  it('draws no CI part when the PR has no checks at all, one check being the other edge', () => {
    expect(build(ready(pr(), []))[0]).toMatchObject({ ci: null })
    expect(build(ready(pr(), [check('success')]))[0]).toMatchObject({ ci: 'passed' })
  })

  it('lets a merged pull request say Merged in place of its CI, as the app does', () => {
    const [pill] = build(ready(pr({ state: 'merged' }), [check('failure')]))
    expect(pill).toMatchObject({ state: 'merged', ci: null })
  })

  it('keeps CI on draft and closed pull requests, which the app draws it on', () => {
    expect(build(ready(pr({ state: 'draft' }), [check('failure')]))[0]).toMatchObject({
      ci: 'failed'
    })
    expect(build(ready(pr({ state: 'closed' }), [check('success')]))[0]).toMatchObject({
      ci: 'passed'
    })
  })
})

describe('a branch with no pull request', () => {
  const none: PrSidebarState = { kind: 'none' }

  it('offers Create PR when the host says the branch can open one now', () => {
    expect(build(none, eligible({ canCreate: true }))).toEqual([
      { kind: 'create-pr', label: 'Create PR' }
    ])
  })

  it('offers Create PR when a push first is all that stands in the way (pushable)', () => {
    expect(build(none, eligible({ canCreate: false, blockedReason: 'needs_push' }))).toEqual([
      { kind: 'create-pr', label: 'Create PR' }
    ])
  })

  it('says Local changes for a branch that exists only on this computer', () => {
    expect(build(none, eligible({ canCreate: false, blockedReason: 'no_upstream' }))).toEqual([
      { kind: 'local-changes', label: 'Local changes', hint: LOCAL_CHANGES_HINT }
    ])
  })

  it.each(['detached_head', 'default_branch', 'auth_required', 'unsupported_provider', 'dirty'])(
    'draws nothing for a branch the host blocks as %s: no answer about its push state',
    (blockedReason) => {
      expect(build(none, eligible({ canCreate: false, blockedReason }))).toEqual([])
    }
  )

  it('draws nothing until the host has answered, and nothing when it could not', () => {
    expect(build(none, { kind: 'idle' })).toEqual([])
    expect(build(none, { kind: 'loading', eligibility: null })).toEqual([])
    expect(build(none, { kind: 'error' })).toEqual([])
  })

  it('keeps the last answer on screen while a newer one is read', () => {
    const prior = reply({ canCreate: true })
    expect(build(none, { kind: 'loading', eligibility: prior })).toEqual([
      { kind: 'create-pr', label: 'Create PR' }
    ])
  })
})

describe('no data, no pill', () => {
  it.each<[string, PrSidebarState]>([
    ['hidden', { kind: 'hidden' }],
    ['loading', { kind: 'loading' }],
    ['error', { kind: 'error', message: 'timed out' }],
    ['blocked', { kind: 'blocked', message: 'no GitHub account' }]
  ])('draws nothing while the pull request read is %s, even with an eligible branch', (_n, state) => {
    expect(build(state, eligible({ canCreate: true }))).toEqual([])
  })

  it('draws nothing on a repo that is not a hosted-review remote', () => {
    expect(build(ready(pr(), []), NO_REVIEW, { hosted: false })).toEqual([])
    expect(build({ kind: 'none' }, eligible({ canCreate: true }), { hosted: false })).toEqual([])
  })

  it('draws nothing without a branch (detached HEAD, mid-rebase, a folder workspace)', () => {
    expect(build(ready(pr(), []), NO_REVIEW, { branch: null })).toEqual([])
  })

  it('never draws a Diff pill: the user removed it on 2026-10-12', () => {
    const everything = [
      build(ready(pr(), [check('success')])),
      build({ kind: 'none' }, eligible({ canCreate: true })),
      build({ kind: 'none' }, eligible({ blockedReason: 'no_upstream' }))
    ].flat()
    expect(everything.map((pill) => pill.kind)).not.toContain('diff')
  })
})

describe('the Local changes hint', () => {
  it('says the app’s words, apostrophe and all', () => {
    expect(LOCAL_CHANGES_HINT).toBe(
      'This branch is on your computer. Ask Claude to push when you’re ready to open a PR.'
    )
  })

  it('is at most 280 dp wide, the app’s cap (jc20.g)', () => {
    expect(LOCAL_CHANGES_HINT_MAX_WIDTH).toBe(280)
  })
})

describe('Copy PR number', () => {
  function deps(write: () => Promise<void> = async () => {}) {
    return { clipboard: { writeText: vi.fn(write) }, showToast: vi.fn() }
  }

  it('puts the number the pill shows on the clipboard and says so', async () => {
    const d = deps()
    await sessionPillActions(d).copyPrNumber(7701)
    expect(d.clipboard.writeText).toHaveBeenCalledWith('#7701')
    expect(d.showToast).toHaveBeenCalledWith('PR number copied')
  })

  it('says a copy that did not land did not happen', async () => {
    const d = deps(async () => {
      throw new Error('the clipboard did not accept this text')
    })
    await sessionPillActions(d).copyPrNumber(7701)
    expect(d.showToast).toHaveBeenCalledWith("Couldn't copy PR number", 1500)
  })
})

describe('the pills of a session whose pull request Anthropic reported', () => {
  const claude = (over: Partial<Parameters<typeof buildClaudeSessionPills>[0]> = {}) =>
    buildClaudeSessionPills({
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
    })

  it('lays the Diff pill before the pull request pill, as the app’s row does (i35.java:261-266)', () => {
    expect(claude().map((pill) => pill.kind)).toEqual(['diff', 'pull-request'])
    expect(claude()[0]).toEqual({
      kind: 'diff',
      label: 'Diff',
      added: 11542,
      removed: 3602,
      url: 'https://github.com/nexdash/NexOS-Mobile/pull/12/files'
    })
  })

  it('opens the files page of a PR URL that ends in a slash without doubling it', () => {
    expect(claude({ url: 'https://github.com/o/r/pull/12/' })[0]).toMatchObject({ url: 'https://github.com/o/r/pull/12/files' })
  })

  it.each([
    ['open', 'Open', 'success', 'failed'],
    ['draft', 'Draft', 'muted', 'pending'],
    ['closed', 'Closed', 'danger', 'unavailable'],
    ['merged', 'Merged', 'merged', null],
    ['queued', 'Queued', 'queued', null]
  ] as const)('words a %s pull request as %s, tinted %s, with CI %s', (state, stateLabel, tint, ci) => {
    expect(claude({ state, ci })[1]).toMatchObject({
      kind: 'pull-request',
      number: 12,
      label: '#12',
      state,
      stateLabel,
      tint,
      ci,
      spoken: 'Pull request #12',
      source: 'claude'
    })
  })

  it('draws no Diff pill for a pull request with no lines in it, and one for a single side', () => {
    expect(claude({ additions: 0, deletions: 0 }).map((pill) => pill.kind)).toEqual(['pull-request'])
    expect(claude({ additions: 12, deletions: 0 })[0]).toMatchObject({ kind: 'diff', added: 12, removed: 0 })
    expect(claude({ additions: 0, deletions: 4 })[0]).toMatchObject({ kind: 'diff', added: 0, removed: 4 })
  })

  it('is never what Orca’s own builder makes: it draws no Diff pill however many lines it knows', () => {
    const pills = buildSessionPills({ hosted: true, branch: 'b', pr: { kind: 'none' }, eligibility: { kind: 'idle' } })
    expect(pills.some((pill) => pill.kind === 'diff')).toBe(false)
  })
})
