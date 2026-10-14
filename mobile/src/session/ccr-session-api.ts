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
export type CcrFetch = (url: string, init: { method: 'GET'; headers: Record<string, string> }) => Promise<CcrFetchResponse>

export type CcrFailureReason =
  | 'unauthorized'
  | 'forbidden'
  | 'untrusted-device'
  | 'not-found'
  | 'http'
  | 'network'
  | 'malformed'

export type CcrRequestStage = 'org' | 'sessions' | 'events'

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

/** Remote session ids as Claude Code accepts them (@79412602). */
const SESSION_ID = /^(cse|session)_[A-Za-z0-9_-]{1,128}$/

export function isCcrSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID.test(id)
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

async function getJson(fetchImpl: CcrFetch, stage: CcrRequestStage, url: string, headers: Record<string, string>): Promise<unknown> {
  let response: CcrFetchResponse
  try {
    response = await fetchImpl(url, { method: 'GET', headers })
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
    throw new CcrApiError(stage, 'http', status)
  }
  try {
    return await response.json()
  } catch {
    throw new CcrApiError(stage, 'malformed', response.status)
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
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
}

export type CcrSessionPage = { sessions: CcrSessionRow[]; nextCursor: string | null; malformedRows: number }

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
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
    const row = record(item)
    if (!row || !isCcrSessionId(row.id)) {
      malformedRows += 1
      continue
    }
    sessions.push({
      id: row.id,
      environmentKind: stringOrNull(row.environment_kind),
      title: stringOrNull(row.title),
      status: stringOrNull(row.status),
      connectionStatus: stringOrNull(row.connection_status),
      activeAt: timeOf(row),
      model: stringOrNull(record(row.external_metadata)?.model),
      effortLevel: stringOrNull(record(row.external_metadata)?.effort_level)
    })
  }
  return { sessions, nextCursor: cursorOf(body.next_cursor), malformedRows }
}

export type CcrEvent = { eventId: string | null; payload: Record<string, unknown> }
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
    const event = record(item)
    const payload = record(event?.payload)
    if (event && payload) {
      events.push({ eventId: stringOrNull(event.event_id), payload })
    }
  }
  return { events, nextCursor: cursorOf(body.next_cursor) }
}
