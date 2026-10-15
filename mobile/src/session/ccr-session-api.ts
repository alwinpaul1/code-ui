/**
 * Anthropic's Claude Code session API, read with the phone's own sign-in
 * (dictation/anthropic-auth-store.ts: Claude Code's OAuth client, scope
 * `user:sessions:claude_code` among its six).
 *
 * A Claude Code session with Remote Control on (the user's
 * `remoteControlAtStartup`, or the org's default) is published there as a
 * `bridge` session, and its events carry the transcript's messages with the
 * pictures still in them: the base64 `image` blocks Orca's transcript reader
 * drops (orca src/main/native-chat/transcript-line-decoders-claude.ts:25-27).
 * That is how the Claude app draws them. This module only talks to the API;
 * matching a tab to a session and taking the pictures out are elsewhere
 * (ccr-session-match.ts, ccr-session-images.ts, ccr-session-pipeline.ts).
 *
 * Where each request comes from (Claude Android app, jadx of the APK, and
 * Claude Code 2.1.296's binary, by byte offset):
 *  - list: `GET v1/code/sessions?cursor&limit` (app m4v.java:119-144), reply
 *    `{data, next_cursor, resume_token}` (hmj.java/fmj.java), rows with
 *    `id`, `environment_kind`, `title`, `status`, `connection_status`,
 *    `updated_at`, `last_event_at` (eyu.java);
 *  - events: `GET v1/code/sessions/{id}/events?cursor&sort_order=desc&limit`
 *    (m4v.java:95-101), reply `{data, next_cursor}` (eij.java), events
 *    `{event_id, sequence_num, event_type, source, payload, created_at}`
 *    (du7.java); Claude Code reads the same URL with this token
 *    (`/v1/code/sessions/${e}/events?limit=${R}&sort_order=desc`, @225597422);
 *  - headers: `X-Organization-Uuid`, `Anthropic-Version: 2023-06-01`,
 *    `Anthropic-Beta: ccr-byoc-2025-07-29` (o4v.java:21-26) and
 *    `Anthropic-Client-Platform: android` (s0n.java:38). Claude Code sends
 *    `anthropic-client-platform: claude_code_cli` for the same token
 *    (@186680313); if the server ever refuses `android` for a Claude Code
 *    token, that is the value to try;
 *  - base URL: the app talks to `https://claude.ai` under its own login
 *    (xu0.java:5). This token is Claude Code's, and Claude Code sends it to
 *    `https://api.anthropic.com` (`BASE_API_URL`, @187105711);
 *  - org: `GET /api/oauth/profile` with `Authorization`, `Content-Type` and
 *    `Cache-Control: no-cache` (Claude Code's r4e, @189975225), reply
 *    `{account: {uuid}, organization: {uuid, name}}` (@216056919).
 *
 * React Native's fetch (OkHttp) adds no `Origin` header; only its WebSocket
 * did (commit 40bcbde7f).
 *
 * Nothing here logs a token. Errors carry the stage, the HTTP status and a
 * reason word, never a header or a body.
 */

import { isCcrSessionId, parseCcrSessionRow, record, stringOrNull, type CcrSessionRow } from './ccr-session-row'

export { branchesOfRow, isCcrSessionId, parseCcrSessionRow, type CcrBranchRef, type CcrSessionRow } from './ccr-session-row'

export const CCR_API_BASE_URL = 'https://api.anthropic.com'
export const CCR_ANTHROPIC_VERSION = '2023-06-01'
export const CCR_ANTHROPIC_BETA = 'ccr-byoc-2025-07-29'
export const CCR_CLIENT_PLATFORM = 'android'

export type CcrFetchResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text?: () => Promise<string>
}
export type CcrFetch = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }) => Promise<CcrFetchResponse>

export type CcrFailureReason =
  | 'unauthorized'
  | 'forbidden'
  | 'untrusted-device'
  | 'not-found'
  | 'session-not-active'
  | 'http'
  | 'network'
  | 'malformed'

export type CcrRequestStage = 'org' | 'sessions' | 'session' | 'events' | 'stream' | 'branches' | 'usage' | 'files'

export class CcrApiError extends Error {
  constructor(
    readonly stage: CcrRequestStage,
    readonly reason: CcrFailureReason,
    readonly status?: number
  ) {
    super(`${stage}: ${reason}${status === undefined ? '' : ` (HTTP ${status})`}`)
    this.name = 'CcrApiError'
  }
}

/** The headers the Claude app sends on its code-session calls, with the phone's token. */
export function ccrSessionHeaders(token: string, organizationUuid: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Anthropic-Version': CCR_ANTHROPIC_VERSION,
    'Anthropic-Beta': CCR_ANTHROPIC_BETA,
    'X-Organization-Uuid': organizationUuid,
    'Anthropic-Client-Platform': CCR_CLIENT_PLATFORM
  }
}

/** The headers Claude Code sends to its profile endpoint. */
export function ccrProfileHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache'
  }
}

const UNTRUSTED_DEVICE = /trusted[\s_-]?device|device[\s_-]?(?:identity|trust)/i

async function getJson(fetchImpl: CcrFetch, stage: CcrRequestStage, url: string, headers: Record<string, string>, post?: { body: string }): Promise<unknown> {
  let response: CcrFetchResponse
  try {
    response = await fetchImpl(url, post ? { method: 'POST', headers, body: post.body } : { method: 'GET', headers })
  } catch {
    throw new CcrApiError(stage, 'network')
  }
  if (!response.ok) {
    const status = response.status
    if (status === 401) {
      throw new CcrApiError(stage, 'unauthorized', status)
    }
    if (status === 403) {
      // Claude Code reads a 403 as an untrusted-device refusal when the body
      // says so (CBn, @189797743); the body's words are read, never logged.
      const body = await response.text?.().catch(() => '') ?? ''
      throw new CcrApiError(stage, UNTRUSTED_DEVICE.test(body) ? 'untrusted-device' : 'forbidden', status)
    }
    if (status === 404) {
      throw new CcrApiError(stage, 'not-found', status)
    }
    if (status === 409) {
      // A POST into a session whose computer is offline: `session_not_active` (P13, 2026-10-15).
      const body = await response.text?.().catch(() => '') ?? ''
      throw new CcrApiError(stage, /session_not_active/.test(body) ? 'session-not-active' : 'http', status)
    }
    throw new CcrApiError(stage, 'http', status)
  }
  try {
    return await response.json()
  } catch {
    throw new CcrApiError(stage, 'malformed', response.status)
  }
}

function cursorOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export type CcrProfile = { accountUuid: string; organizationUuid: string; organizationName: string | null }

export async function fetchCcrProfile(fetchImpl: CcrFetch, token: string): Promise<CcrProfile> {
  const body = record(await getJson(fetchImpl, 'org', `${CCR_API_BASE_URL}/api/oauth/profile`, ccrProfileHeaders(token)))
  const accountUuid = record(body?.account)?.uuid
  const organizationUuid = record(body?.organization)?.uuid
  if (typeof organizationUuid !== 'string' || !organizationUuid || typeof accountUuid !== 'string' || !accountUuid) {
    throw new CcrApiError('org', 'malformed')
  }
  return { accountUuid, organizationUuid, organizationName: stringOrNull(record(body?.organization)?.name) || null }
}

export type CcrSessionPage = { sessions: CcrSessionRow[]; nextCursor: string | null; malformedRows: number }

function query(params: Record<string, string | number | null | undefined>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
  }
  return parts.join('&')
}

export async function listCcrSessions(
  fetchImpl: CcrFetch,
  auth: { token: string; organizationUuid: string },
  page: { cursor: string | null; limit: number }
): Promise<CcrSessionPage> {
  const url = `${CCR_API_BASE_URL}/v1/code/sessions?${query({ cursor: page.cursor, limit: page.limit })}`
  const body = record(await getJson(fetchImpl, 'sessions', url, ccrSessionHeaders(auth.token, auth.organizationUuid)))
  if (!body || !Array.isArray(body.data)) {
    throw new CcrApiError('sessions', 'malformed')
  }
  const sessions: CcrSessionRow[] = []
  let malformedRows = 0
  for (const item of body.data) {
    const row = parseCcrSessionRow(item)
    if (!row) {
      malformedRows += 1
      continue
    }
    sessions.push(row)
  }
  return { sessions, nextCursor: cursorOf(body.next_cursor), malformedRows }
}

/** One session's row: `GET v1/code/sessions/{id}` (the app's m4v.java), the same row a list page holds. */
export async function getCcrSession(fetchImpl: CcrFetch, auth: { token: string; organizationUuid: string }, sessionId: string): Promise<CcrSessionRow> {
  if (!isCcrSessionId(sessionId)) {
    throw new CcrApiError('session', 'malformed')
  }
  const url = `${CCR_API_BASE_URL}/v1/code/sessions/${encodeURIComponent(sessionId)}`
  const row = parseCcrSessionRow(await getJson(fetchImpl, 'session', url, ccrSessionHeaders(auth.token, auth.organizationUuid)))
  if (!row) {
    throw new CcrApiError('session', 'malformed')
  }
  return row
}

export type CcrEvent = {
  eventId: string | null
  payload: Record<string, unknown>
  /** The server's order (`sequence_num`; a POST's reply carries it as a string, "16"). */
  sequenceNum?: number | null
  /** `worker` (Claude Code) or `client` (a phone or the web), as observed. */
  source?: string | null
  /** Epoch ms of `created_at`, or null. */
  createdAt?: number | null
}

function sequenceOf(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

/** One event as a history page or a stream frame holds it; `fallbackSequence` is the frame's SSE id. */
export function parseCcrEvent(item: unknown, fallbackSequence: string | null = null): CcrEvent | null {
  const event = record(item)
  const payload = record(event?.payload)
  if (!event || !payload) {
    return null
  }
  const created = typeof event.created_at === 'string' ? Date.parse(event.created_at) : Number.NaN
  return {
    eventId: stringOrNull(event.event_id),
    payload,
    sequenceNum: sequenceOf(event.sequence_num) ?? sequenceOf(fallbackSequence),
    source: stringOrNull(event.source),
    createdAt: Number.isFinite(created) ? created : null
  }
}
export type CcrEventPage = { events: CcrEvent[]; nextCursor: string | null }

export async function listCcrSessionEvents(
  fetchImpl: CcrFetch,
  auth: { token: string; organizationUuid: string },
  sessionId: string,
  page: { cursor: string | null; limit: number }
): Promise<CcrEventPage> {
  if (!isCcrSessionId(sessionId)) {
    throw new CcrApiError('events', 'malformed')
  }
  const url = `${CCR_API_BASE_URL}/v1/code/sessions/${encodeURIComponent(sessionId)}/events?${query({
    cursor: page.cursor,
    sort_order: 'desc',
    limit: page.limit
  })}`
  const body = record(await getJson(fetchImpl, 'events', url, ccrSessionHeaders(auth.token, auth.organizationUuid)))
  if (!body || !Array.isArray(body.data)) {
    throw new CcrApiError('events', 'malformed')
  }
  const events: CcrEvent[] = []
  for (const item of body.data) {
    const event = parseCcrEvent(item)
    if (event) {
      events.push(event)
    }
  }
  return { events, nextCursor: cursorOf(body.next_cursor) }
}

/** A POST with a JSON body to the code API, errors as the other stages' (`getJson`'s). */
export function postCcrJson(fetchImpl: CcrFetch, stage: CcrRequestStage, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  return getJson(fetchImpl, stage, url, { ...headers, 'Content-Type': 'application/json' }, { body: JSON.stringify(body) })
}

/** One plan-usage window of an account, as the phone's rows draw it. */
export type CcrUsageWindow = {
  name: 'Session' | 'Weekly'
  /** Percent of the window used, 0 to 100 (Claude Code floors it for `/usage`). */
  usedPercent: number
  windowMinutes: number
  /** Epoch SECONDS, or null when the reply states none. */
  resetsAt: number | null
}

/** The reply's reset: an ISO time, or epoch seconds (milliseconds when it is that large). */
function resetOf(value: unknown): number | null {
  if (typeof value === 'string') {
    const at = Date.parse(value)
    return Number.isFinite(at) ? Math.floor(at / 1000) : null
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value > 1e12 ? value / 1000 : value)
  }
  return null
}

const USAGE_WINDOWS = [
  { key: 'five_hour', name: 'Session', windowMinutes: 300 },
  { key: 'seven_day', name: 'Weekly', windowMinutes: 10_080 }
] as const

/**
 * The account's own 5-hour and weekly plan usage: `GET /api/oauth/usage` with THAT account's token,
 * the call Claude Code's `/usage` makes (2.1.300, `fetchUtilization`), with the profile call's headers
 * (live 2026-10-15: 200 for both accounts with and without the OAuth beta header, so none is sent).
 * Its `five_hour` and `seven_day` carry `utilization` in percent
 * (`${Math.floor(limit.utilization)}% used`) and `resets_at`. A window the reply omits or leaves null
 * is not drawn; a reply with none is an account with no plan window (an API key): no rows.
 * Live shape, 2026-10-15 (shapes only): `five_hour` and `seven_day` are `{utilization: number, resets_at:
 * ISO string with microseconds and an offset, limit_dollars, used_dollars, remaining_dollars,
 * locked_reason}`; the other windows are null; `limits: [{kind, percent, ...}]` also comes.
 */
export async function fetchCcrAccountUsage(fetchImpl: CcrFetch, token: string): Promise<CcrUsageWindow[]> {
  return (await fetchCcrAccountPlan(fetchImpl, token)).windows
}

/** One row of the Usage sheet's "Plan usage" and "Weekly limits" cards. */
export type CcrPlanRow = {
  kind: 'session' | 'weekly_all' | 'weekly_scoped'
  /** 0..100, as the reply states it. */
  percent: number
  /** Epoch SECONDS, or null when the reply states none. */
  resetsAt: number | null
  /** The model a `weekly_scoped` limit is for (`scope.model.display_name`, "Fable"); else null. */
  modelName: string | null
}

const PLAN_ROW_KINDS: readonly CcrPlanRow['kind'][] = ['session', 'weekly_all', 'weekly_scoped']

/**
 * The Usage sheet's plan rows, as the Claude app 1.261009.20 reads them: the reply's `limits`
 * (`UsageResponse.limits`, j610.java; `UsageLimit`, n510.java: `kind`, `group`, `percent`,
 * `severity`, `resets_at`, `scope{model{display_name}, surface}`, `is_active`; `LimitKind`
 * "session" | "weekly_all" | "weekly_scoped", yfj.java via tw9.java:24). The app asks
 * `organizations/{orgId}/usage?skip_spend=1` (d310.java:12-16); `/api/oauth/usage`, which the phone
 * can call with the account's own OAuth token, carries the same `limits` (live 2026-10-15). A kind
 * the app does not know, a row with no percent, and a scoped row with no model are left out.
 * With no `limits` at all, `five_hour` is the session row and `seven_day` the all-models row.
 * Sessions first, then the weekly rows, each group in the reply's order.
 */
export function readCcrPlanRows(body: Record<string, unknown>): CcrPlanRow[] {
  const rows: CcrPlanRow[] = []
  if (Array.isArray(body.limits)) {
    for (const item of body.limits) {
      const limit = record(item)
      const kind = PLAN_ROW_KINDS.find((entry) => entry === limit?.kind)
      const percent = limit?.percent
      if (!limit || !kind || typeof percent !== 'number' || !Number.isFinite(percent)) {
        continue
      }
      const name = record(record(limit.scope)?.model)?.display_name
      const modelName = kind === 'weekly_scoped' && typeof name === 'string' && name.trim() ? name.trim() : null
      if (kind === 'weekly_scoped' && modelName === null) {
        continue
      }
      rows.push({ kind, percent: Math.max(0, Math.min(100, Math.round(percent))), resetsAt: resetOf(limit.resets_at), modelName })
    }
  }
  if (rows.length === 0) {
    for (const [key, kind] of [['five_hour', 'session'], ['seven_day', 'weekly_all']] as const) {
      const window = record(body[key])
      const used = window?.utilization
      if (window && typeof used === 'number' && Number.isFinite(used)) {
        rows.push({ kind, percent: Math.max(0, Math.min(100, Math.round(used))), resetsAt: resetOf(window.resets_at), modelName: null })
      }
    }
  }
  const order = (row: CcrPlanRow): number => (row.kind === 'session' ? 0 : 1)
  return rows.map((row, index) => ({ row, index })).sort((a, b) => order(a.row) - order(b.row) || a.index - b.index).map(({ row }) => row)
}

/** The account's plan usage in both shapes: the HUD's two windows and the Usage sheet's rows. */
export async function fetchCcrAccountPlan(fetchImpl: CcrFetch, token: string): Promise<{ windows: CcrUsageWindow[]; rows: CcrPlanRow[] }> {
  const body = record(
    await getJson(fetchImpl, 'usage', `${CCR_API_BASE_URL}/api/oauth/usage`, ccrProfileHeaders(token))
  )
  if (!body) {
    throw new CcrApiError('usage', 'malformed')
  }
  return { windows: readCcrUsageWindows(body), rows: readCcrPlanRows(body) }
}

function readCcrUsageWindows(body: Record<string, unknown>): CcrUsageWindow[] {
  const windows: CcrUsageWindow[] = []
  for (const { key, name, windowMinutes } of USAGE_WINDOWS) {
    const window = record(body[key])
    const used = window?.utilization
    if (window && typeof used === 'number' && Number.isFinite(used)) {
      windows.push({ name, usedPercent: Math.max(0, Math.min(100, used)), windowMinutes, resetsAt: resetOf(window.resets_at) })
    }
  }
  return windows
}
