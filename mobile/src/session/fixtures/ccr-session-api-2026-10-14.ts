import type { CcrFetch, CcrFetchResponse } from '../ccr-session-api'
import type { CcrAccountsSource } from '../ccr-session-shared'

// ─── Anthropic's Claude Code session API, in the shapes it answers with ─────
//
// Sources, each shape cited where it is built below:
//  - the Claude Android app (jadx): the session list reply `{data,
//    next_cursor, resume_token}` (hmj.java, fmj.java), a session row's fields
//    (eyu.java, rzu.java), the events reply `{data, next_cursor}` (eij.java),
//    an event's fields (du7.java), the content blocks (rkt.java, image
//    lkt.java/qih.java, tool_result mnt.java/knt.java);
//  - OBSERVED LIVE, 2026-10-14 16:30, the user's account, read by the
//    coordinator with the same headers this client sends: the profile reply's
//    keys (`account`, `organization`, `application`, `enabled_plugins`); rows
//    with a 28-character `cse_…` id, `environment_kind: "bridge"`,
//    `connection_status` connected/disconnected and a `title`; events with
//    exactly `created_at, device_attestation_status, event_id, event_type,
//    payload, sent_by_account_id, sequence_num, source`, `payload.uuid` on
//    every one of 4,000, mostly `system` (3,363) beside `assistant` 269,
//    `user` 156, `rate_limit_event` 106, `result` 45, `control_request` 31
//    and `control_response` 30; a Read's picture as an `image` block with a
//    base64 source inside `tool_result.content` (6 of 101 results), and
//    pasted pictures as top-level `image` blocks of a user message (8);
//  - the payload is the transcript record's message: this machine's
//    transcript of Claude Code 2.1.296 (session 211c47c2) holds the Read
//    result as `{tool_use_id, type: "tool_result", content: [{type: "image",
//    source: {type: "base64", data, media_type: "image/png"}}]}` and a paste
//    as `[{type: "text", text: "[Image #1] [Image #2] …"}, {type: "image",
//    source: {type: "base64", media_type: "image/jpeg", data}}, …]`.
//
// Ids are made up in the observed shapes. The pictures are tiny real files.

/** A 1×1 PNG. */
export const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** The start of a JPEG (SOI and JFIF header), padded to a whole base64 quantum. */
export const JPEG_HEAD = '/9j/4AAQSkZJRgABAQAAAQABAAD/'
/** A 1×1 lossless WebP. */
export const WEBP_1PX = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='

export const ACCOUNT_UUID = '61c5b078-0000-4000-8000-00000000a001'
export const ORG_UUID = '8f3fa7c8-0000-4000-8000-00000000b002'
export const TOKEN = 'test-oauth-token-not-a-real-credential'

/** 28 characters, as observed. */
export const SESSION_A = 'cse_01QXaaaaaaaaaaaaaaaaaaaa'
export const SESSION_B = 'cse_01QXbbbbbbbbbbbbbbbbbbbb'
export const SESSION_CLOUD = 'cse_01QXcccccccccccccccccccc'

export function profileReply(): unknown {
  return {
    account: { uuid: ACCOUNT_UUID, email_address: 'user@example.com' },
    organization: { uuid: ORG_UUID, name: 'Example org' },
    application: { uuid: 'app', name: 'Claude Code' },
    enabled_plugins: []
  }
}

/** A session row (eyu.java's fields). */
export function sessionRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    environment_id: 'env_01',
    environment_kind: 'bridge',
    title: 'CI failure on main',
    status: 'active',
    worker_status: 'idle',
    connection_status: 'connected',
    created_at: '2026-10-14T10:00:00Z',
    updated_at: '2026-10-14T16:00:00Z',
    last_event_at: '2026-10-14T16:20:00Z',
    external_metadata: {},
    unread: false,
    ...overrides
  }
}

export function sessionsReply(rows: unknown[], nextCursor: string | null = null): unknown {
  return { data: rows, next_cursor: nextCursor, resume_token: null }
}

let sequence = 1000

/** An event with exactly the keys observed live. */
export function event(payload: Record<string, unknown>): Record<string, unknown> {
  sequence += 1
  return {
    created_at: '2026-10-14T16:20:00Z',
    device_attestation_status: 'not_required',
    event_id: `evt_${sequence}`,
    event_type: String(payload.type ?? 'system'),
    payload,
    sent_by_account_id: ACCOUNT_UUID,
    sequence_num: sequence,
    source: 'worker'
  }
}

export function systemEvent(uuid: string): Record<string, unknown> {
  return event({ type: 'system', subtype: 'status', uuid, session_id: SESSION_A })
}

export function assistantEvent(uuid: string, toolUseId: string, path: string): Record<string, unknown> {
  return event({
    type: 'assistant',
    uuid,
    session_id: SESSION_A,
    parent_tool_use_id: null,
    message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: toolUseId, name: 'Read', input: { file_path: path } }] }
  })
}

export function imageBlock(data: string, mediaType = 'image/png'): Record<string, unknown> {
  return { type: 'image', source: { type: 'base64', data, media_type: mediaType } }
}

/** The user message carrying a Read's picture, as the transcript holds it. */
export function readResultEvent(uuid: string, toolUseId: string, content: unknown): Record<string, unknown> {
  return event({
    type: 'user',
    uuid,
    session_id: SESSION_A,
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content }] }
  })
}

/** A prompt with pasted pictures: the `[Image #N]` text, then the images. */
export function pasteEvent(uuid: string, images: Record<string, unknown>[], text = '[Image #1] [Image #2] Fix this issue'): Record<string, unknown> {
  return event({
    type: 'user',
    uuid,
    session_id: SESSION_A,
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text }, ...images] }
  })
}

export function eventsReply(events: unknown[], nextCursor: string | null = null): unknown {
  return { data: events, next_cursor: nextCursor }
}

export type RecordedRequest = { url: string; method: string; headers: Record<string, string> }

export type Route = (url: URL) => CcrFetchResponse | Promise<CcrFetchResponse> | null

export function reply(status: number, body: unknown): CcrFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (typeof body === 'string') {
        throw new SyntaxError('Unexpected token')
      }
      return body
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  }
}

/** A fetch that answers by route and keeps every request it was sent. */
export function fakeFetch(routes: Route[]): { fetch: CcrFetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetch: CcrFetch = async (url, init) => {
    requests.push({ url, method: init.method, headers: { ...init.headers } })
    const parsed = new URL(url)
    for (const route of routes) {
      const answer = await route(parsed)
      if (answer) {
        return answer
      }
    }
    return reply(404, { error: { type: 'not_found_error' } })
  }
  return { fetch, requests }
}

/** The usual three routes: profile, list, and each session's event pages by cursor. */
export function apiRoutes(args: {
  profile?: CcrFetchResponse
  sessions?: (cursor: string | null) => CcrFetchResponse
  events?: Record<string, (cursor: string | null) => CcrFetchResponse>
}): Route[] {
  return [
    (url) => (url.pathname === '/api/oauth/profile' ? (args.profile ?? reply(200, profileReply())) : null),
    (url) => (url.pathname === '/v1/code/sessions' && args.sessions ? args.sessions(url.searchParams.get('cursor')) : null),
    (url) => {
      const match = /^\/v1\/code\/sessions\/([^/]+)\/events$/.exec(url.pathname)
      const page = match ? args.events?.[decodeURIComponent(match[1]!)] : undefined
      return page ? page(url.searchParams.get('cursor')) : null
    }
  ]
}

// ─── The phone's signed-in accounts, as the pipeline reads them ─────────────

export type FakeAccount = { id: string; label: string; token: string | null; organizationUuid: string | null; error?: string }

/** The one account most tests sign in: the shapes of `profileReply()`. */
export function defaultAccount(overrides: Partial<FakeAccount> = {}): FakeAccount {
  return { id: ACCOUNT_UUID, label: 'Example org', token: TOKEN, organizationUuid: null, ...overrides }
}

/** An in-memory accounts source that keeps what the pipeline tells it, for assertions. */
export function fakeAccounts(initial: FakeAccount[]): { source: CcrAccountsSource; accounts: FakeAccount[]; forgotten: string[] } {
  const accounts = initial.map((account) => ({ ...account }))
  const forgotten: string[] = []
  const source: CcrAccountsSource = {
    list: async (only) =>
      accounts.filter((account) => only === undefined || account.id === only).map((account) => ({ id: account.id, label: account.label, accessToken: account.token, organizationUuid: account.organizationUuid, error: account.error })),
    rememberProfile: async (id, profile) => {
      const account = accounts.find((candidate) => candidate.id === id)
      if (account) {
        account.id = profile.accountUuid
        account.organizationUuid = profile.organizationUuid
      }
      return profile.accountUuid
    },
    forgetOrganization: async (id) => {
      forgotten.push(id)
      const account = accounts.find((candidate) => candidate.id === id)
      if (account) {
        account.organizationUuid = null
      }
    }
  }
  return { source, accounts, forgotten }
}

/** One signed-in account with its organization already kept, or nobody when `token` is null. */
export function singleAccountSource(token: string | null = TOKEN, organizationUuid: string | null = ORG_UUID): CcrAccountsSource {
  return fakeAccounts(token === null ? [] : [defaultAccount({ token, organizationUuid })]).source
}
