import { describe, expect, it } from 'vitest'
import { readCcrStreamFrame } from './ccr-event-stream'
import { buildCcrUserEventBody, CCR_REMOTE_CONTROL_OFFLINE, ccrEchoSeen, ccrSessionOffline, newCcrEventUuid, postCcrSessionEvents, readCcrConnectionStatus } from './ccr-send'
import type { CcrFetch, CcrFetchResponse } from './ccr-session-api'
import { ORG_UUID, TOKEN, sessionRow } from './fixtures/ccr-session-api-2026-10-14'

// The Claude Android app 1.261009.20's send (sessions.store.a, y2v, rs8.F4), and the reply probe P1
// read live on 2026-10-15 from a Remote Control session (200, `results[{duplicate, event_id,
// sequence_num}]`, the event id equal to the posted uuid).
const P1_REPLY = { attestation_feedback: null, results: [{ duplicate: false, event_id: '3d21b74e-4199-4dd4-b56e-4b60c3eb0cdf', sequence_num: '16' }] }
const PERSONAL_CSE = 'cse_01NmzBrN6cdXv6SaRde5pR7H'

type Sent = { url: string; method: string; headers: Record<string, string>; body: unknown }

function recorder(answer: (call: number) => CcrFetchResponse): { fetch: CcrFetch; sent: Sent[] } {
  const sent: Sent[] = []
  const fetch: CcrFetch = async (url, init) => {
    sent.push({ url, method: init.method, headers: { ...init.headers }, body: init.body ? JSON.parse(init.body) : undefined })
    return answer(sent.length)
  }
  return { fetch, sent }
}
const ok = (body: unknown): CcrFetchResponse => ({ ok: true, status: 200, json: async () => body })
const status = (code: number): CcrFetchResponse => ({ ok: false, status: code, json: async () => ({}), text: async () => '' })

describe('a Claude tab message posted into its Remote Control session, as the Claude app posts it', () => {
  it('posts the user message with the client uuid to the session events endpoint, with the account own sign-in', async () => {
    const { fetch, sent } = recorder(() => ok(P1_REPLY))
    const asked: string[] = []
    const auth = async (accountId: string) => {
      asked.push(accountId)
      return { token: TOKEN, organizationUuid: ORG_UUID }
    }
    const uuid = '3d21b74e-4199-4dd4-b56e-4b60c3eb0cdf'
    await postCcrSessionEvents({ fetch, auth }, 'acct-personal', PERSONAL_CSE, buildCcrUserEventBody({ sessionId: PERSONAL_CSE, uuid, text: 'run the tests' }))
    expect(asked).toEqual(['acct-personal'])
    expect(sent).toHaveLength(1)
    expect(sent[0]!.method).toBe('POST')
    expect(sent[0]!.url).toBe(`https://api.anthropic.com/v1/code/sessions/${PERSONAL_CSE}/events`)
    expect(sent[0]!.headers).toMatchObject({ 'Anthropic-Beta': 'ccr-byoc-2025-07-29', 'X-Organization-Uuid': ORG_UUID, 'Content-Type': 'application/json' })
    expect(sent[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(sent[0]!.body).toEqual({ session_id: PERSONAL_CSE, events: [{ payload: { type: 'user', uuid, message: { role: 'user', content: 'run the tests' } } }] })
  })

  it('names the session cse_ in the path and the body when it was given as session_', () => {
    expect(buildCcrUserEventBody({ sessionId: 'session_01Abc', uuid: 'u', text: 't' }).session_id).toBe('cse_01Abc')
  })

  it('carries priority only on a steering or post-later send', () => {
    expect(buildCcrUserEventBody({ sessionId: PERSONAL_CSE, uuid: 'u', text: 't' }).events[0]!.payload).not.toHaveProperty('priority')
    expect(buildCcrUserEventBody({ sessionId: PERSONAL_CSE, uuid: 'u', text: 't', priority: 'later' }).events[0]!.payload.priority).toBe('later')
  })

  it('reads the sign-in afresh once after a 401, then posts again', async () => {
    const { fetch, sent } = recorder((call) => (call === 1 ? status(401) : ok(P1_REPLY)))
    const fresh: boolean[] = []
    await postCcrSessionEvents({ fetch, auth: async (_id, isFresh) => (fresh.push(isFresh), { token: TOKEN, organizationUuid: ORG_UUID }) }, 'a', PERSONAL_CSE, buildCcrUserEventBody({ sessionId: PERSONAL_CSE, uuid: 'u', text: 't' }))
    expect(fresh).toEqual([false, true])
    expect(sent).toHaveLength(2)
  })

  it('fails with the stage and status, never a body or a token, when the server refuses', async () => {
    const { fetch } = recorder(() => status(500))
    const failure = await postCcrSessionEvents({ fetch, auth: async () => ({ token: TOKEN, organizationUuid: ORG_UUID }) }, 'a', PERSONAL_CSE, buildCcrUserEventBody({ sessionId: PERSONAL_CSE, uuid: 'u', text: 't' })).catch((error: Error) => error.message)
    expect(failure).toBe('events: http (HTTP 500)')
    expect(String(failure)).not.toContain(TOKEN)
  })

  it('mints a dashed v4 uuid even where the platform has no randomUUID', () => {
    let n = 0
    const id = newCcrEventUuid(() => ((n += 7) % 16) / 16)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('the offline refusal (rs8.G4, p230.j)', () => {
  it('is the app own words', () => {
    expect(CCR_REMOTE_CONTROL_OFFLINE).toBe('Remote control session is offline. Reconnect or run /remote-control to start a new session.')
  })

  it('refuses only a disconnected session; connected, unknown and absent statuses are not refused', () => {
    expect(ccrSessionOffline('disconnected')).toBe(true)
    expect(ccrSessionOffline('DISCONNECTED')).toBe(true)
    for (const other of ['connected', 'unknown', 'unspecified', null, undefined]) {
      expect(ccrSessionOffline(other)).toBe(false)
    }
  })

  it('reads the row connection_status with the account own sign-in', async () => {
    const { fetch, sent } = recorder(() => ok(sessionRow(PERSONAL_CSE, { connection_status: 'disconnected' })))
    expect(await readCcrConnectionStatus({ fetch, auth: async () => ({ token: TOKEN, organizationUuid: ORG_UUID }) }, 'a', PERSONAL_CSE)).toBe('disconnected')
    expect(sent[0]!.url).toBe(`https://api.anthropic.com/v1/code/sessions/${PERSONAL_CSE}`)
  })
})

describe('the echo of a phone send', () => {
  const frame = (payload: Record<string, unknown>) => {
    const read = readCcrStreamFrame({
      event: 'client_event',
      id: '16',
      data: JSON.stringify({ event_id: payload.uuid, sequence_num: 16, event_type: 'user', source: 'client', payload, created_at: '2026-10-15T00:41:00Z' })
    })
    if (read.kind !== 'event') {
      throw new Error(`not an event: ${read.kind}`)
    }
    return read.event
  }

  it('is found by its uuid on the stream', () => {
    const uuid = '3d21b74e-4199-4dd4-b56e-4b60c3eb0cdf'
    expect(ccrEchoSeen([frame({ type: 'user', uuid, message: { role: 'user', content: 'run the tests' } })], uuid)).toBe(true)
  })

  it('is never found by its words: the same text under another uuid is not this send', () => {
    expect(ccrEchoSeen([frame({ type: 'user', uuid: 'other', message: { role: 'user', content: 'run the tests' } })], 'mine')).toBe(false)
    expect(ccrEchoSeen([], 'mine')).toBe(false)
  })
})
