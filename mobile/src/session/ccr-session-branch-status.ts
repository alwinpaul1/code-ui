import {
  CCR_API_BASE_URL,
  CcrApiError,
  ccrSessionHeaders,
  postCcrJson,
  type CcrBranchRef,
  type CcrFetch
} from './ccr-session-api'

/**
 * The pull request and diff pills of a Remote Control session, from the same call the Claude
 * Android app makes for them (com.anthropic.claude 1.261009.20, jadx):
 *
 *  - request: `POST v1/code/github/get-batch-branch-status` (m4v.java:60-64), body `prf`
 *    (utf.java:100, prf.java, nrf.java): `repo_branches` (`por`: `repo`, `branch`), `session_id`,
 *    `discover_session_prs: true`, `include_ci_status: true` when the app wants the CI dot (the
 *    session screen asks for it), headers as the session list's;
 *  - reply: `{branch_statuses: [y74]}` (qrf.java:19, srf). A `y74` (w74.java): `repo`, `branch`,
 *    `pull_request`, `has_changes`, `commits`, `branch_exists`, `session_id`, `ghe_configuration_id`,
 *    `kind`. A `pull_request` (`s74`, q74.java): `number`, `additions`, `deletions`, `commits`,
 *    `state`, `title`, `url`, `checks`, `head_sha`, and review fields. A check (`s1p`, q1p.java):
 *    `name`, `typename`, `status`, `conclusion`, `state`, `html_url`;
 *  - the state word is read lower-cased: closed, merged, queued, open, draft (v130.o, v130.java:367),
 *    anything else is no pill; a PR with no `url` opens `https://github.com/<repo>/pull/<number>`
 *    (utf.e, utf.java:116-150);
 *  - the CI roll-up (t130.n, t130.java:393, with t130.b for each check): a StatusContext reads its
 *    `state` (SUCCESS passes, FAILURE and ERROR fail, anything else pends); a check run is pending
 *    until its `status` is COMPLETED, then its `conclusion` decides (SUCCESS passes; FAILURE,
 *    TIMED_OUT, ACTION_REQUIRED and STARTUP_FAILURE fail; the rest are neutral). Any failure fails
 *    the whole; else no pending and at least one pass passes; else pending only while the PR is
 *    open or a draft; else "status unavailable". No checks at all is "status unavailable" too.
 *  - the Diff pill's two numbers, in the app, are the sums over the files of a branch compare
 *    (`v1/code/github/compare-refs`, blc.java:32-75) or of the session's own edits; here they are
 *    the PR's `additions` and `deletions`, which are the same totals for a branch with a PR. A
 *    session on a computer (Remote Control) with no PR gets its numbers from a `get_workspace_diff`
 *    control request sent into the session (qaa.java, c2b.java:259); this phone sends none, so a
 *    branch without a PR has no Diff pill.
 *
 * Nothing in the decompile says what a live reply of this endpoint looks like byte for byte, or
 * whether the sign-in Claude Code gives the phone is allowed to call it: the parser takes a shape
 * only as the app reads it and refuses any other (no PR, not a guess), and a failed call leaves
 * the tab with today's Orca pills. A live capture settles both (see the report).
 */

export type CcrPrState = 'draft' | 'open' | 'closed' | 'merged' | 'queued'
export type CcrCiStatus = 'pending' | 'passed' | 'failed' | 'unavailable'

export type CcrBranchPr = {
  repo: string
  branch: string
  /** The `session_id` the server attributed the branch to, when it says one. */
  sessionId: string | null
  number: number
  state: CcrPrState
  url: string
  /** Null when the app would draw no CI part: a merged or queued PR says its state in its place. */
  ci: CcrCiStatus | null
  additions: number
  deletions: number
}

export const CCR_BRANCH_STATUS_URL = `${CCR_API_BASE_URL}/v1/code/github/get-batch-branch-status`

const STATES: ReadonlySet<string> = new Set(['draft', 'open', 'closed', 'merged', 'queued'])

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function upper(value: unknown): string | null {
  return typeof value === 'string' ? value.toUpperCase() : null
}

type CheckVerdict = 'fail' | 'pending' | 'neutral' | 'pass'

/** `t130.b`: one check's verdict. */
function checkVerdict(check: Record<string, unknown>): CheckVerdict {
  if (check.typename === 'StatusContext') {
    switch (upper(check.state)) {
      case 'SUCCESS':
        return 'pass'
      case 'FAILURE':
      case 'ERROR':
        return 'fail'
      default:
        return 'pending'
    }
  }
  if (upper(check.status) !== 'COMPLETED') {
    return 'pending'
  }
  switch (upper(check.conclusion)) {
    case 'SUCCESS':
      return 'pass'
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'ACTION_REQUIRED':
    case 'STARTUP_FAILURE':
      return 'fail'
    default:
      return 'neutral'
  }
}

/** `t130.n`: the dot of a pull request, for its checks (an absent list is an empty one). */
export function ciRollup(checks: unknown, state: CcrPrState): CcrCiStatus {
  const verdicts = (Array.isArray(checks) ? checks : [])
    .map((check) => record(check))
    .filter((check): check is Record<string, unknown> => check !== null)
    .map(checkVerdict)
  if (verdicts.length > 0) {
    if (verdicts.includes('fail')) {
      return 'failed'
    }
    const pending = verdicts.includes('pending')
    if (!pending && verdicts.includes('pass')) {
      return 'passed'
    }
    if (pending && (state === 'open' || state === 'draft')) {
      return 'pending'
    }
  }
  return 'unavailable'
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** One branch status's pull request, or null for a shape the app would not read as one. */
export function branchPrOf(status: unknown): CcrBranchPr | null {
  const entry = record(status)
  const pr = record(entry?.pull_request)
  if (!entry || !pr || typeof entry.repo !== 'string' || typeof entry.branch !== 'string') {
    return null
  }
  const number = pr.number
  const state = typeof pr.state === 'string' ? pr.state.toLowerCase() : null
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0 || state === null || !STATES.has(state)) {
    return null
  }
  const prState = state as CcrPrState
  const url = typeof pr.url === 'string' && pr.url ? pr.url : `https://github.com/${entry.repo}/pull/${number}`
  return {
    repo: entry.repo,
    branch: entry.branch,
    sessionId: typeof entry.session_id === 'string' && entry.session_id ? entry.session_id : null,
    number,
    state: prState,
    url,
    ci: prState === 'merged' || prState === 'queued' ? null : ciRollup(pr.checks, prState),
    additions: count(pr.additions) ?? 0,
    deletions: count(pr.deletions) ?? 0
  }
}

/**
 * The pull request of the session's branch: the first of the session's own pairs (current
 * branches before outcomes, `CcrSessionRow.branches`) that the reply answers with a pull request.
 * A reply row for a pair the session does not name is not the session's, unless the server says it
 * is (`session_id`).
 */
export function pickBranchPr(reply: unknown, pairs: readonly CcrBranchRef[], sessionId: string | null = null): CcrBranchPr | null {
  const rows = record(reply)?.branch_statuses
  if (!Array.isArray(rows)) {
    throw new CcrApiError('branches', 'malformed')
  }
  const prs = rows.map(branchPrOf).filter((pr): pr is CcrBranchPr => pr !== null)
  for (const pair of pairs) {
    const found = prs.find((pr) => pr.repo.toLowerCase() === pair.repo.toLowerCase() && pr.branch === pair.branch)
    if (found) {
      return found
    }
  }
  // A pull request the server itself attributes to this session (`discover_session_prs`), for a row
  // that names no branch the phone could ask about.
  return (sessionId && prs.find((pr) => pr.sessionId === sessionId)) || null
}

export async function fetchCcrBranchPr(
  fetchImpl: CcrFetch,
  auth: { token: string; organizationUuid: string },
  session: { sessionId: string; pairs: readonly CcrBranchRef[] }
): Promise<CcrBranchPr | null> {
  const reply = await postCcrJson(fetchImpl, 'branches', CCR_BRANCH_STATUS_URL, ccrSessionHeaders(auth.token, auth.organizationUuid), {
    repo_branches: session.pairs.map(({ repo, branch }) => ({ repo, branch })),
    session_id: session.sessionId,
    discover_session_prs: true,
    include_ci_status: true
  })
  return pickBranchPr(reply, session.pairs, session.sessionId)
}
