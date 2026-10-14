import { describe, expect, it } from 'vitest'
import {
  CcrApiError,
  ccrSessionHeaders,
  fetchCcrProfile,
  isCcrSessionId,
  listCcrSessionEvents,
  listCcrSessions
} from './ccr-session-api'
import {
  ACCOUNT_UUID,
  ORG_UUID,
  SESSION_A,
  TOKEN,
  event,
  eventsReply,
  fakeFetch,
  profileReply,
  reply,
  sessionRow,
  sessionsReply,
  systemEvent
} from './fixtures/ccr-session-api-2026-10-14'

const auth = { token: TOKEN, organizationUuid: ORG_UUID }

async function failure(promise: Promise<unknown>): Promise<CcrApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(CcrApiError)
    return error as CcrApiError
  }
  throw new Error('expected a failure')
}

describe('the requests the phone sends to the session API', () => {
  it('reads the organization from /api/oauth/profile with the headers Claude Code sends', async () => {
    const { fetch, requests } = fakeFetch([() => reply(200, profileReply())])
    await expect(fetchCcrProfile(fetch, TOKEN)).resolves.toEqual({ accountUuid: ACCOUNT_UUID, organizationUuid: ORG_UUID, organizationName: 'Example org' })
    expect(requests).toEqual([
      {
        url: 'https://api.anthropic.com/api/oauth/profile',
        method: 'GET',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
      }
    ])
  })

  it('lists sessions at /v1/code/sessions with the app’s headers, no cursor on the first page', async () => {
    const { fetch, requests } = fakeFetch([() => reply(200, sessionsReply([sessionRow(SESSION_A)]))])
    await listCcrSessions(fetch, auth, { cursor: null, limit: 50 })
    expect(requests[0]!.url).toBe('https://api.anthropic.com/v1/code/sessions?limit=50')
    expect(requests[0]!.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Anthropic-Version': '2023-06-01',
      'Anthropic-Beta': 'ccr-byoc-2025-07-29',
      'X-Organization-Uuid': ORG_UUID,
      'Anthropic-Client-Platform': 'android'
    })
  })

  it('passes the cursor of a later page', async () => {
    const { fetch, requests } = fakeFetch([() => reply(200, sessionsReply([]))])
    await listCcrSessions(fetch, auth, { cursor: 'c/2+', limit: 50 })
    expect(requests[0]!.url).toBe('https://api.anthropic.com/v1/code/sessions?cursor=c%2F2%2B&limit=50')
  })

  it('reads events newest first, as the app does', async () => {
    const { fetch, requests } = fakeFetch([() => reply(200, eventsReply([]))])
    await listCcrSessionEvents(fetch, auth, SESSION_A, { cursor: null, limit: 100 })
    await listCcrSessionEvents(fetch, auth, SESSION_A, { cursor: 'next', limit: 100 })
    expect(requests.map((request) => request.url)).toEqual([
      `https://api.anthropic.com/v1/code/sessions/${SESSION_A}/events?sort_order=desc&limit=100`,
      `https://api.anthropic.com/v1/code/sessions/${SESSION_A}/events?cursor=next&sort_order=desc&limit=100`
    ])
    expect(requests[0]!.headers['X-Organization-Uuid']).toBe(ORG_UUID)
  })

  it('never builds a URL from an id that is not a session id', async () => {
    const { fetch, requests } = fakeFetch([() => reply(200, eventsReply([]))])
    expect((await failure(listCcrSessionEvents(fetch, auth, '../oauth/profile', { cursor: null, limit: 1 }))).reason).toBe('malformed')
    expect(requests).toEqual([])
  })

  it('accepts the ids Claude Code accepts, and nothing else', () => {
    expect(isCcrSessionId(SESSION_A)).toBe(true)
    expect(isCcrSessionId('session_01abc')).toBe(true)
    expect(isCcrSessionId('cse_')).toBe(false)
    expect(isCcrSessionId('cse_a/b')).toBe(false)
    expect(isCcrSessionId(42)).toBe(false)
  })

  it('builds headers with the token only in Authorization', () => {
    const headers = ccrSessionHeaders(TOKEN, ORG_UUID)
    expect(Object.entries(headers).filter(([, value]) => value.includes(TOKEN)).map(([key]) => key)).toEqual(['Authorization'])
  })
})

describe('reading the replies', () => {
  it('takes rows, their kind, status, time and reported model, and the next cursor', async () => {
    const { fetch } = fakeFetch([
      () =>
        reply(
          200,
          sessionsReply([sessionRow(SESSION_A, { external_metadata: { model: 'claude-opus-5-5', effort_level: 'high' } }), { id: 'not-a-session' }, 'junk'], 'next')
        )
    ])
    const page = await listCcrSessions(fetch, auth, { cursor: null, limit: 50 })
    expect(page).toEqual({
      sessions: [
        {
          id: SESSION_A,
          environmentKind: 'bridge',
          title: 'CI failure on main',
          status: 'active',
          connectionStatus: 'connected',
          activeAt: Date.parse('2026-10-14T16:20:00Z'),
          model: 'claude-opus-5-5',
          effortLevel: 'high'
        }
      ],
      nextCursor: 'next',
      malformedRows: 2
    })
  })

  it('reads an empty list as no sessions and no further page', async () => {
    const { fetch } = fakeFetch([() => reply(200, sessionsReply([], ''))])
    await expect(listCcrSessions(fetch, auth, { cursor: null, limit: 50 })).resolves.toEqual({ sessions: [], nextCursor: null, malformedRows: 0 })
  })

  it('keeps each event’s payload and drops an event with none', async () => {
    const { fetch } = fakeFetch([() => reply(200, eventsReply([systemEvent('u1'), { event_id: 'x' }, event({ type: 'user', uuid: 'u2' })], 'c2'))])
    const page = await listCcrSessionEvents(fetch, auth, SESSION_A, { cursor: null, limit: 100 })
    expect(page.events.map((item) => item.payload.uuid)).toEqual(['u1', 'u2'])
    expect(page.nextCursor).toBe('c2')
  })

  it('refuses a profile without an organization', async () => {
    const { fetch } = fakeFetch([() => reply(200, { account: { uuid: ACCOUNT_UUID } })])
    expect((await failure(fetchCcrProfile(fetch, TOKEN))).reason).toBe('malformed')
  })
})

describe('each way a request fails', () => {
  const cases: [string, () => ReturnType<typeof reply> | Promise<never>, string, number | undefined][] = [
    ['401', () => reply(401, { error: { type: 'authentication_error' } }), 'unauthorized', 401],
    ['403', () => reply(403, { error: { type: 'permission_error', message: 'Remote Control is disabled' } }), 'forbidden', 403],
    ['403 from an untrusted device', () => reply(403, { error: { type: 'permission_error', message: 'This device is not a trusted device' } }), 'untrusted-device', 403],
    ['404', () => reply(404, {}), 'not-found', 404],
    ['500', () => reply(500, {}), 'http', 500],
    ['no network', () => Promise.reject(new TypeError('Network request failed')), 'network', undefined],
    ['a body that is not JSON', () => reply(200, '<html>'), 'malformed', 200],
    ['JSON that is not a list', () => reply(200, { data: 'nope' }), 'malformed', undefined]
  ]
  it.each(cases)('names %s', async (_name, answer, reason, status) => {
    const fetch = async () => answer()
    const error = await failure(listCcrSessions(fetch, auth, { cursor: null, limit: 50 }))
    expect(error.reason).toBe(reason)
    expect(error.status).toBe(status)
    expect(error.stage).toBe('sessions')
    expect(error.message).not.toContain(TOKEN)
  })
})
