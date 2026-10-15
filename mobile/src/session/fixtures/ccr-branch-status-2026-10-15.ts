import type { CcrFetch, CcrFetchResponse } from '../ccr-session-api'

// ─── Anthropic's branch-status reply, in the shape the Claude app reads ─────
//
// NOT observed live. Every field name below is read from the Claude Android app 1.261009.20
// (jadx, 2026-10-15), the class that declares it named in parentheses; no capture of the real reply
// exists yet (the live GET the report asks for settles that, and these fixtures are then to be
// replaced by it):
//  - the reply: `{branch_statuses: […]}` (qrf.java:19);
//  - a branch status: `repo`, `branch`, `pull_request`, `has_changes`, `commits`, `branch_exists`,
//    `session_id`, `ghe_configuration_id`, `kind` (w74.java:19-27);
//  - its pull request: `number`, `additions`, `deletions`, `commits`, `state`, `title`, `url`,
//    `checks`, `head_sha`, … (q74.java:20-32);
//  - a check: `name`, `typename`, `status`, `conclusion`, `state`, `html_url` (q1p.java:18-23);
//  - the request body: `repo_branches` (`repo`, `branch`), `session_id`, `discover_session_prs`,
//    `include_ci_status` (nrf.java:20-28, nor.java:18-19, utf.java:100);
//  - a session row's branches: `external_metadata.current_branches` (iju.java:23) and
//    `config.outcomes[].git_info` with `repo` and `branches` (feu.java:20, tjn.java:19-21).

export const NEXOS_REPO = 'nexdash/NexOS-Mobile'
export const NEXOS_BRANCH = 'claude/tablet-cab-redesign'

export function checkRun(conclusion: string | null, status = 'COMPLETED', name = 'build'): Record<string, unknown> {
  return { name, typename: 'CheckRun', status, conclusion, state: null, html_url: 'https://example.test/run/1' }
}

export function statusContext(state: string, name = 'ci/legacy'): Record<string, unknown> {
  return { name, typename: 'StatusContext', status: null, conclusion: null, state, html_url: null }
}

export function pullRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 12,
    additions: 11542,
    deletions: 3602,
    commits: 9,
    state: 'OPEN',
    title: 'tablet cab redesign',
    url: 'https://github.com/nexdash/NexOS-Mobile/pull/12',
    checks: [checkRun('SUCCESS')],
    head_sha: '0123456789abcdef0123456789abcdef01234567',
    ...overrides
  }
}

export function branchStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repo: NEXOS_REPO,
    branch: NEXOS_BRANCH,
    pull_request: pullRequest(),
    has_changes: true,
    commits: 9,
    branch_exists: true,
    session_id: null,
    ghe_configuration_id: null,
    kind: 'CHANGE_REQUEST',
    ...overrides
  }
}

export function branchStatusReply(rows: unknown[]): unknown {
  return { branch_statuses: rows }
}

/** A session row naming its branch the two ways the app reads one. */
export function rowWithBranches(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    environment_kind: 'bridge',
    title: 'PR #12 tablet cab redesign',
    status: 'active',
    connection_status: 'connected',
    created_at: '2026-10-14T10:00:00Z',
    updated_at: '2026-10-15T08:00:00Z',
    last_event_at: '2026-10-15T08:00:00Z',
    config: { outcomes: [{ type: 'git_repository', git_info: { type: 'github', repo: NEXOS_REPO, branches: [NEXOS_BRANCH] } }] },
    external_metadata: { current_branches: { [NEXOS_REPO]: NEXOS_BRANCH } },
    ...overrides
  }
}

export type RecordedPost = { url: string; method: string; headers: Record<string, string>; body: unknown }

export function jsonReply(status: number, body: unknown): CcrFetchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

/** A fetch that answers the list and the branch-status POST, keeping every request with its body. */
export function branchFetch(args: { sessions: unknown[]; branchStatus: (body: Record<string, unknown>) => CcrFetchResponse }): { fetch: CcrFetch; requests: RecordedPost[] } {
  const requests: RecordedPost[] = []
  const fetch: CcrFetch = async (url, init) => {
    const body = init.body ? (JSON.parse(init.body) as unknown) : undefined
    requests.push({ url, method: init.method, headers: { ...init.headers }, body })
    const parsed = new URL(url)
    if (parsed.pathname === '/v1/code/sessions') {
      return jsonReply(200, { data: args.sessions, next_cursor: null, resume_token: null })
    }
    if (parsed.pathname === '/v1/code/github/get-batch-branch-status' && init.method === 'POST') {
      return args.branchStatus(body as Record<string, unknown>)
    }
    return jsonReply(404, { error: { type: 'not_found_error' } })
  }
  return { fetch, requests }
}
