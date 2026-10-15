/**
 * A Claude Code session row as the code-session API lists it (`GET v1/code/sessions`, one
 * session by id), parsed into what the phone matches and draws. Split out of
 * `ccr-session-api.ts`, which keeps the requests; the field sources are cited there and below.
 */

/** Remote session ids as Claude Code accepts them (@79412602). */
const SESSION_ID = /^(cse|session)_[A-Za-z0-9_-]{1,128}$/

export function isCcrSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID.test(id)
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export type CcrSessionRow = {
  id: string
  environmentKind: string | null
  title: string | null
  status: string | null
  connectionStatus: string | null
  /** Epoch ms of the row's last activity (`last_event_at`, else `updated_at`, else `created_at`), or 0. */
  activeAt: number
  /** What Claude Code last reported for the session itself, in
   *  `external_metadata`: `model` (the REPL bridge's `reportMetadata({model})`
   *  of its main-loop model, Claude Code 2.1.296 @194691900) and
   *  `effort_level` (`reportMetadata({effort_level})`, @204087170). The app's
   *  session rows carry `external_metadata` (eyu.java, rzu.java). Null when
   *  absent or not a string. */
  model: string | null
  effortLevel: string | null
  /** The session's own context statement, `external_metadata.context_usage` (`used_tokens`,
   *  `max_tokens`): Claude Code writes it each turn (2.1.300, `ct()`: the latest response's input +
   *  cache creation + cache read, and the window it works to), and the Claude app's ring reads it
   *  (`SessionContextUsage`, afu.java; `SessionExternalMetadata.context_usage`, iju.java:29). Null
   *  when absent, or when `max_tokens` is not positive or `used_tokens` negative (afu.java:17). */
  contextUsage?: { usedTokens: number; maxTokens: number } | null
  /** The repo and branch pairs the session works on, as the Claude app asks the branch status
   *  about them (`vy20.i`, jadx): `external_metadata.current_branches` (repo to branch) first, then
   *  each branch of `config.outcomes[].git_info` (`ojn`, `tjn`: `repo`, `branches`). Empty when the
   *  row names none; a pair is kept only when both halves are non-empty strings. */
  branches?: readonly CcrBranchRef[]
}

export type CcrBranchRef = { repo: string; branch: string }

/** The repo and branch pairs a session row names (see `CcrSessionRow.branches`). */
export function branchesOfRow(row: Record<string, unknown>): CcrBranchRef[] {
  const pairs: CcrBranchRef[] = []
  const add = (repo: unknown, branch: unknown) => {
    if (typeof repo === 'string' && repo && typeof branch === 'string' && branch && !pairs.some((pair) => pair.repo === repo && pair.branch === branch)) {
      pairs.push({ repo, branch })
    }
  }
  const current = record(record(row.external_metadata)?.current_branches)
  for (const [repo, branch] of Object.entries(current ?? {})) {
    add(repo, branch)
  }
  const outcomes = record(row.config)?.outcomes
  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    const info = record(record(outcome)?.git_info)
    const branches = info?.branches
    for (const branch of Array.isArray(branches) ? branches : []) {
      add(info?.repo, branch)
    }
  }
  return pairs
}

function contextUsageOf(value: unknown): { usedTokens: number; maxTokens: number } | null {
  const stated = record(value)
  const used = stated?.used_tokens
  const max = stated?.max_tokens
  return typeof used === 'number' && Number.isFinite(used) && used >= 0 && typeof max === 'number' && Number.isFinite(max) && max > 0 ? { usedTokens: used, maxTokens: max } : null
}

function timeOf(row: Record<string, unknown>): number {
  for (const key of ['last_event_at', 'updated_at', 'created_at']) {
    const value = row[key]
    const at = typeof value === 'string' ? Date.parse(value) : Number.NaN
    if (Number.isFinite(at)) {
      return at
    }
  }
  return 0
}

/** One session row (eyu.java's fields), or null when it has no usable id. */
export function parseCcrSessionRow(item: unknown): CcrSessionRow | null {
  const row = record(item)
  if (!row || !isCcrSessionId(row.id)) {
    return null
  }
  return {
    id: row.id,
    environmentKind: stringOrNull(row.environment_kind),
    title: stringOrNull(row.title),
    status: stringOrNull(row.status),
    connectionStatus: stringOrNull(row.connection_status),
    activeAt: timeOf(row),
    model: stringOrNull(record(row.external_metadata)?.model),
    effortLevel: stringOrNull(record(row.external_metadata)?.effort_level),
    contextUsage: contextUsageOf(record(row.external_metadata)?.context_usage),
    branches: branchesOfRow(row)
  }
}
