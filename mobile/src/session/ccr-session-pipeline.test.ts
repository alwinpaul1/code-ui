import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CcrFetchResponse } from './ccr-session-api'
import { ccrModelForTab, resetCcrModelForTests } from './ccr-session-model'
import {
  CCR_MAX_CANDIDATES,
  CCR_MAX_EVENT_PAGES,
  CCR_MAX_LIST_PAGES,
  ccrMayRun,
  ccrSessionForTab,
  ccrToolImage,
  ccrUserImages,
  maskId,
  refreshCcrModel,
  resetCcrPipelineForTests,
  runCcrImagePipeline,
  type CcrPipelineDeps,
  type CcrPipelineInput
} from './ccr-session-pipeline'
import {
  ACCOUNT_UUID,
  JPEG_HEAD,
  ORG_UUID,
  PNG_1PX,
  SESSION_A,
  SESSION_B,
  SESSION_CLOUD,
  TOKEN,
  apiRoutes,
  defaultAccount,
  fakeAccounts,
  singleAccountSource,
  assistantEvent,
  eventsReply,
  fakeFetch,
  imageBlock,
  pasteEvent,
  readResultEvent,
  reply,
  sessionRow,
  sessionsReply,
  systemEvent,
  type Route
} from './fixtures/ccr-session-api-2026-10-14'

const READ_CALL = 'toolu_01BZkRyL4RMKF29GvgyXyp8w'
const PASTE_ID = 'd7245783-7183-4668-b62f-3630e6303da9'
const TAB_MESSAGES = ['fae82585-cd65-43d6-9e29-8d60e172685b', '4df636b3-e768-4dbf-a93b-30f0cc01b742', PASTE_ID]

function harness(routes: Route[], options: { token?: string | null; org?: { accountUuid: string; organizationUuid: string } | null } = {}) {
  const { fetch, requests } = fakeFetch(routes)
  const lines: { line: string; ok: boolean }[] = []
  const token = options.token === undefined ? TOKEN : options.token
  const kept = fakeAccounts(token === null ? [] : [defaultAccount({ token, organizationUuid: options.org?.organizationUuid ?? null })])
  const deps: CcrPipelineDeps = {
    fetch,
    accounts: kept.source,
    keep: (key, uri) => `kept:${key.replace(/\0/g, '|')}:${uri.slice(0, 22)}`,
    maxBytes: 8 * 1024 * 1024,
    log: (line, ok) => lines.push({ line, ok })
  }
  const org = () => (kept.accounts[0]?.organizationUuid ? { accountUuid: kept.accounts[0].id, organizationUuid: kept.accounts[0].organizationUuid } : null)
  return { deps, requests, lines, forgotten: kept.forgotten, accounts: kept.accounts, org }
}

const input = (overrides: Partial<CcrPipelineInput> = {}): CcrPipelineInput => ({
  tabId: 'tab-1',
  epoch: 1,
  messageIds: TAB_MESSAGES,
  wanted: { toolUseIds: [READ_CALL], userMessageIds: [PASTE_ID] },
  ...overrides
})

/** Session A is this tab's: its newest page holds system events, the Read and its picture, and the paste. */
const sessionAPage = eventsReply([
  systemEvent('sys-1'),
  readResultEvent(TAB_MESSAGES[1]!, READ_CALL, [imageBlock(PNG_1PX)]),
  assistantEvent(TAB_MESSAGES[0]!, READ_CALL, '/tmp/codeui.png'),
  pasteEvent(PASTE_ID, [imageBlock(JPEG_HEAD, 'image/jpeg'), imageBlock(PNG_1PX)]),
  systemEvent('sys-2')
])

const twoSessions = (rows = [sessionRow(SESSION_A, { external_metadata: { model: 'claude-opus-5-5', effort_level: 'high' } }), sessionRow(SESSION_B, { last_event_at: '2026-10-14T15:00:00Z' })]) =>
  apiRoutes({
    sessions: () => reply(200, sessionsReply(rows)),
    events: {
      [SESSION_A]: () => reply(200, sessionAPage),
      [SESSION_B]: () => reply(200, eventsReply([systemEvent('other-1')]))
    }
  })

beforeEach(() => {
  resetCcrPipelineForTests()
  resetCcrModelForTests()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('the whole path, against recorded-shape replies', () => {
  it('signs in, reads the org, lists, matches the tab and finds both kinds of picture', async () => {
    const h = harness(twoSessions())
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.stages.map((stage) => [stage.stage, stage.ok])).toEqual([
      ['sign-in', true],
      ['org', true],
      ['sessions', true],
      ['match', true],
      ['model', true],
      ['images', true]
    ])
    expect(result).toMatchObject({ sessionId: SESSION_A, found: 2, wanted: 2 })
    expect(h.requests.map((request) => request.url)).toEqual([
      'https://api.anthropic.com/api/oauth/profile',
      'https://api.anthropic.com/v1/code/sessions?limit=50',
      `https://api.anthropic.com/v1/code/sessions/${SESSION_A}/events?sort_order=desc&limit=100`,
      `https://api.anthropic.com/v1/code/sessions/${SESSION_B}/events?sort_order=desc&limit=100`
    ])
    for (const request of h.requests.slice(1)) {
      expect({ ...request.headers, Authorization: request.headers.Authorization === `Bearer ${TOKEN}` ? '<token>' : 'wrong' }).toEqual({
        Authorization: '<token>',
        'Anthropic-Version': '2023-06-01',
        'Anthropic-Beta': 'ccr-byoc-2025-07-29',
        'X-Organization-Uuid': ORG_UUID,
        'Anthropic-Client-Platform': 'android'
      })
    }
    expect(ccrToolImage(READ_CALL)).toBe(`kept:ccr|tool|${READ_CALL}:data:image/png;base64,`)
    expect(ccrUserImages(PASTE_ID)).toEqual([`kept:ccr|user|${PASTE_ID}|0:data:image/jpeg;base64`, `kept:ccr|user|${PASTE_ID}|1:data:image/png;base64,`])
    expect(h.org()).toEqual({ accountUuid: ACCOUNT_UUID, organizationUuid: ORG_UUID })
    expect(ccrSessionForTab('tab-1', 1)).toBe(SESSION_A)
  })

  it('leaves one line per stage, ids masked and the token never written', async () => {
    const h = harness(twoSessions())
    await runCcrImagePipeline(input(), h.deps)
    expect(h.lines.map((entry) => entry.line)).toEqual([
      '[ccr-images] sign-in: ok — signed in (tab tab… (5))',
      `[ccr-images] org: ok — organization ${maskId(ORG_UUID)} (from /api/oauth/profile) (tab tab… (5))`,
      '[ccr-images] sessions: ok — 2 Remote Control sessions to compare (2 listed) (tab tab… (5))',
      `[ccr-images] match: ok — session cse…aaa (28) shares 3 messages with this tab (tab tab… (5))`,
      '[ccr-images] model: ok — model claude-opus-5-5, effort high (tab tab… (5))',
      '[ccr-images] images: ok — 2 of 2 pictures found in 1 page of events (tab tab… (5))'
    ])
    const all = h.lines.map((entry) => entry.line).join('\n')
    expect(all).not.toContain(TOKEN)
    expect(all).not.toContain(ORG_UUID)
    expect(all).not.toContain(SESSION_A)
  })

  it(`compares only Remote Control sessions that are not archived, newest first, at most ${CCR_MAX_CANDIDATES}`, async () => {
    const hours = Array.from({ length: CCR_MAX_CANDIDATES + 2 }, (_, n) => String(n).padStart(2, '0'))
    const rows = [
      sessionRow(SESSION_CLOUD, { environment_kind: 'cloud' }),
      sessionRow('cse_01QXarchivedaaaaaaaaaaaa', { status: 'archived' }),
      ...hours.map((n) => sessionRow(`cse_01QXbridge${n}aaaaaaaaaaaa`, { last_event_at: `2026-10-14T${n}:00:00Z` }))
    ]
    const h = harness([
      ...apiRoutes({ sessions: () => reply(200, sessionsReply(rows)) }),
      (url) => (url.pathname.endsWith('/events') ? reply(200, eventsReply([systemEvent('x')])) : null)
    ])
    await runCcrImagePipeline(input(), h.deps)
    const asked = [...new Set(h.requests.filter((request) => request.url.includes('/events')).map((request) => new URL(request.url).pathname.split('/')[4]))]
    expect(asked).toEqual(hours.toReversed().slice(0, CCR_MAX_CANDIDATES).map((n) => `cse_01QXbridge${n}aaaaaaaaaaaa`))
  })

  it('uses the cached organization and asks the profile nothing', async () => {
    const h = harness(twoSessions(), { org: { accountUuid: ACCOUNT_UUID, organizationUuid: ORG_UUID } })
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.stages[1]).toMatchObject({ stage: 'org', ok: true })
    expect(h.requests.some((request) => request.url.endsWith('/api/oauth/profile'))).toBe(false)
  })
})

describe('pages of the session list', () => {
  const listed = (pages: Record<string, CcrFetchResponse>) => {
    const h = harness([
      ...apiRoutes({
        sessions: (cursor) => pages[cursor ?? 'first']!,
        events: { [SESSION_A]: () => reply(200, sessionAPage) }
      })
    ])
    return h
  }

  it('reads an empty list as "no Remote Control session" and stops', async () => {
    const h = listed({ first: reply(200, sessionsReply([])) })
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.stages.at(-1)).toMatchObject({ stage: 'sessions', ok: false })
    expect(result.stages.at(-1)!.detail).toContain('no Remote Control session on this account (0 sessions listed)')
    expect(h.requests.filter((request) => request.url.includes('/v1/code/sessions?')).length).toBe(1)
  })

  it('follows the cursor to a later page', async () => {
    const h = listed({ first: reply(200, sessionsReply([sessionRow(SESSION_CLOUD, { environment_kind: 'cloud' })], 'p2')), p2: reply(200, sessionsReply([sessionRow(SESSION_A)])) })
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.sessionId).toBe(SESSION_A)
    expect(h.requests.map((request) => request.url).filter((url) => url.includes('/v1/code/sessions?'))).toEqual([
      'https://api.anthropic.com/v1/code/sessions?limit=50',
      'https://api.anthropic.com/v1/code/sessions?cursor=p2&limit=50'
    ])
  })

  it(`stops after ${CCR_MAX_LIST_PAGES} pages however many the server offers`, async () => {
    let served = 0
    const h = harness(
      apiRoutes({
        sessions: () => {
          served += 1
          return reply(200, sessionsReply([], `p${served + 1}`))
        }
      })
    )
    await runCcrImagePipeline(input(), h.deps)
    expect(served).toBe(CCR_MAX_LIST_PAGES)
  })

  it('stops when the server hands back the cursor it was given', async () => {
    let served = 0
    const h = harness(apiRoutes({ sessions: () => (served++, reply(200, sessionsReply([], 'same'))) }))
    await runCcrImagePipeline(input(), h.deps)
    expect(served).toBe(2)
  })
})

describe('pages of a session’s events', () => {
  it('reads on past the match pages until the picture is found, then stops', async () => {
    const pages: Record<string, unknown> = {
      first: eventsReply([systemEvent('s1'), assistantEvent(TAB_MESSAGES[0]!, READ_CALL, '/tmp/codeui.png')], 'c2'),
      c2: eventsReply([systemEvent('s2')], 'c3'),
      c3: eventsReply([readResultEvent(TAB_MESSAGES[1]!, READ_CALL, [imageBlock(PNG_1PX)])], 'c4'),
      c4: eventsReply([systemEvent('never-read')])
    }
    const h = harness(apiRoutes({ sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A)])), events: { [SESSION_A]: (cursor) => reply(200, pages[cursor ?? 'first']) } }))
    const result = await runCcrImagePipeline(input({ wanted: { toolUseIds: [READ_CALL], userMessageIds: [] } }), h.deps)
    expect(result).toMatchObject({ found: 1, wanted: 1 })
    expect(h.requests.filter((request) => request.url.includes('/events')).map((request) => new URL(request.url).searchParams.get('cursor'))).toEqual([null, 'c2', 'c3'])
  })

  it(`gives up after ${CCR_MAX_EVENT_PAGES} pages and says the picture was not in them`, async () => {
    let served = 0
    const h = harness(
      apiRoutes({
        sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A)])),
        events: { [SESSION_A]: () => (served++, reply(200, eventsReply([assistantEvent(TAB_MESSAGES[0]!, 'toolu_other', '/x.png')], `c${served}`))) }
      })
    )
    const result = await runCcrImagePipeline(input({ wanted: { toolUseIds: [READ_CALL], userMessageIds: [] } }), h.deps)
    expect(served).toBe(CCR_MAX_EVENT_PAGES)
    expect(result.stages.at(-1)).toMatchObject({ stage: 'images', ok: false })
    expect(result.stages.at(-1)!.detail).toBe(`0 of 1 picture found in ${CCR_MAX_EVENT_PAGES} pages of events; 1 not in the pages read`)
  })

  it('stops at the last page', async () => {
    const h = harness(
      apiRoutes({
        sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A)])),
        events: { [SESSION_A]: () => reply(200, eventsReply([assistantEvent(TAB_MESSAGES[0]!, 'toolu_other', '/x.png')])) }
      })
    )
    await runCcrImagePipeline(input({ wanted: { toolUseIds: [READ_CALL], userMessageIds: [] } }), h.deps)
    expect(h.requests.filter((request) => request.url.includes('/events')).length).toBe(1)
  })
})

describe('the tab’s match', () => {
  it('is kept for the connection, so a second run lists nothing', async () => {
    const h = harness(twoSessions())
    await runCcrImagePipeline(input(), h.deps)
    const before = h.requests.length
    await runCcrImagePipeline(input({ wanted: { toolUseIds: ['toolu_new'], userMessageIds: [] } }), h.deps)
    const after = h.requests.slice(before).map((request) => request.url)
    expect(after.some((url) => url.includes('/v1/code/sessions?'))).toBe(false)
    expect(after).toEqual([`https://api.anthropic.com/v1/code/sessions/${SESSION_A}/events?sort_order=desc&limit=100`])
  })

  it('is matched again once the relay connects anew (stale cache invalidated)', async () => {
    const h = harness(twoSessions())
    await runCcrImagePipeline(input(), h.deps)
    expect(ccrSessionForTab('tab-1', 2)).toBeNull()
    const before = h.requests.length
    await runCcrImagePipeline(input({ epoch: 2 }), h.deps)
    expect(h.requests.slice(before).some((request) => request.url.includes('/v1/code/sessions?'))).toBe(true)
  })

  it('is dropped when the session is gone (404 on its events)', async () => {
    let gone = false
    const h = harness(
      apiRoutes({
        sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A)])),
        events: { [SESSION_A]: () => (gone ? reply(404, {}) : reply(200, sessionAPage)) }
      })
    )
    await runCcrImagePipeline(input(), h.deps)
    gone = true
    const result = await runCcrImagePipeline(input({ wanted: { toolUseIds: ['toolu_new'], userMessageIds: [] } }), h.deps)
    expect(result.stages.at(-1)).toMatchObject({ stage: 'images', ok: false })
    expect(result.stages.at(-1)!.detail).toBe('not found (HTTP 404) after 0 pages')
    expect(ccrSessionForTab('tab-1', 1)).toBeNull()
  })

  it('shares one run between two callers', async () => {
    const h = harness(twoSessions())
    const [a, b] = await Promise.all([runCcrImagePipeline(input(), h.deps), runCcrImagePipeline(input(), h.deps)])
    expect(a).toBe(b)
    expect(h.requests.filter((request) => request.url.endsWith('/api/oauth/profile')).length).toBe(1)
  })
})

describe('every failure leaves the chips and one line saying why', () => {
  const cases: [string, () => ReturnType<typeof harness>, string, string][] = [
    ['not signed in', () => harness(twoSessions(), { token: null }), 'sign-in', 'not signed in to Anthropic on this phone (Voice settings → Sign in)'],
    ['the profile refuses the token', () => harness(apiRoutes({ profile: reply(401, {}) })), 'org', 'the sign-in was refused (HTTP 401); sign in again in Voice settings'],
    ['a profile with no organization', () => harness(apiRoutes({ profile: reply(200, { account: {} }) })), 'org', 'the reply was not the expected shape'],
    [
      'an untrusted device',
      () => harness(apiRoutes({ sessions: () => reply(403, { error: { message: 'trusted device required' } }) })),
      'sessions',
      'this phone is not a trusted device for the organization (HTTP 403)'
    ],
    ['no network', () => harness([() => Promise.reject(new TypeError('Network request failed'))]), 'org', 'network error (no answer from api.anthropic.com)'],
    [
      'no Remote Control session',
      () => harness(apiRoutes({ sessions: () => reply(200, sessionsReply([sessionRow(SESSION_CLOUD, { environment_kind: 'cloud' })])) })),
      'sessions',
      'no Remote Control session on this account (1 session listed); Claude Code publishes a session only with Remote Control on'
    ],
    [
      'no session shares a message',
      () => harness(apiRoutes({ sessions: () => reply(200, sessionsReply([sessionRow(SESSION_B)])), events: { [SESSION_B]: () => reply(200, eventsReply([systemEvent('x')])) } })),
      'match',
      'none of 1 Remote Control session shares a message with this tab in its latest 200 events'
    ],
    [
      'two sessions share messages',
      () =>
        harness(
          apiRoutes({
            sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A), sessionRow(SESSION_B)])),
            events: { [SESSION_A]: () => reply(200, sessionAPage), [SESSION_B]: () => reply(200, eventsReply([systemEvent(TAB_MESSAGES[0]!)])) }
          })
        ),
      'match',
      '2 sessions share messages with this tab (cse…aaa (28), cse…bbb (28)); not guessing'
    ],
    [
      'a malformed events reply',
      () => harness(apiRoutes({ sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A)])), events: { [SESSION_A]: () => reply(200, { data: null }) } })),
      'match',
      'the reply was not the expected shape'
    ],
    [
      'no picture in the event',
      () =>
        harness(
          apiRoutes({
            sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A)])),
            events: { [SESSION_A]: () => reply(200, eventsReply([assistantEvent(TAB_MESSAGES[0]!, READ_CALL, '/x.png'), readResultEvent('r', READ_CALL, 'File read')])) }
          })
        ),
      'images',
      '0 of 1 picture found in 1 page of events; 1 no-image-in-event'
    ]
  ]

  it.each(cases)('%s', async (_name, make, stage, detail) => {
    const h = make()
    const result = await runCcrImagePipeline(input({ wanted: { toolUseIds: [READ_CALL], userMessageIds: [] } }), h.deps)
    expect(result.stages.at(-1)).toEqual({ stage, ok: false, detail })
    expect(h.lines.at(-1)).toEqual({ ok: false, line: `[ccr-images] ${stage}: failed — ${detail} (tab tab… (5))` })
    expect(ccrToolImage(READ_CALL)).toBeUndefined()
    expect(h.lines.map((entry) => entry.line).join('\n')).not.toContain(TOKEN)
  })

  it('says so when the sign-in cannot be read at all', async () => {
    const h = harness(twoSessions())
    h.deps.accounts.list = async () => {
      throw new Error('keystore locked')
    }
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.stages).toEqual([{ stage: 'sign-in', ok: false, detail: 'the sign-in could not be read: keystore locked' }])
  })

  it('forgets the cached organization when the list refuses it', async () => {
    const h = harness(apiRoutes({ sessions: () => reply(403, {}) }), { org: { accountUuid: ACCOUNT_UUID, organizationUuid: ORG_UUID } })
    await runCcrImagePipeline(input(), h.deps)
    expect(h.forgotten).toEqual([ACCOUNT_UUID])
  })

  it('waits before trying again, longer each time, and not after a new connection', async () => {
    const h = harness(twoSessions(), { token: null })
    const t0 = Date.now()
    await runCcrImagePipeline(input(), h.deps)
    expect(ccrMayRun('tab-1', 1, t0 + 1_000)).toBe(false)
    expect(ccrMayRun('tab-1', 1, t0 + 31_000)).toBe(true)
    expect(ccrMayRun('tab-1', 2, t0 + 1_000)).toBe(true)
    await runCcrImagePipeline(input(), h.deps)
    expect(ccrMayRun('tab-1', 1, Date.now() + 31_000)).toBe(false)
    expect(ccrMayRun('tab-1', 1, Date.now() + 61_000)).toBe(true)
  })

  it('clears the wait once a run succeeds', async () => {
    const h = harness(twoSessions(), { token: null })
    await runCcrImagePipeline(input(), h.deps)
    h.deps.accounts = singleAccountSource()
    await runCcrImagePipeline(input(), h.deps)
    expect(ccrMayRun('tab-1', 1)).toBe(true)
  })
})

describe('the model and effort the session reports', () => {
  it('is kept for the matched tab', async () => {
    const h = harness(twoSessions())
    await runCcrImagePipeline(input(), h.deps)
    expect(ccrModelForTab('tab-1', 1)).toMatchObject({ sessionId: SESSION_A, model: 'claude-opus-5-5', effort: 'high' })
  })

  it('is refreshed from the list for a matched tab', async () => {
    let effort = 'high'
    const h = harness(
      apiRoutes({
        sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A, { external_metadata: { model: 'claude-opus-5-5', effort_level: effort } })])),
        events: { [SESSION_A]: () => reply(200, sessionAPage) }
      })
    )
    await runCcrImagePipeline(input(), h.deps)
    effort = 'xhigh'
    const report = await refreshCcrModel('tab-1', 1, h.deps)
    expect(report).toEqual({ stage: 'model', ok: true, detail: 'model claude-opus-5-5, effort xhigh' })
    expect(ccrModelForTab('tab-1', 1)?.effort).toBe('xhigh')
  })

  it('does nothing for a tab not matched on this connection', async () => {
    const h = harness(twoSessions())
    await expect(refreshCcrModel('tab-1', 1, h.deps)).resolves.toBeNull()
    expect(h.requests).toEqual([])
  })

  it.each([
    ['no model reported', {}, 'the session reports no model (external_metadata.model absent); the pill keeps the beacon/transcript'],
    ['an id the phone cannot name', { model: 'claude-mystery' }, 'the session reports a model id this phone cannot name (claude-mystery); the pill keeps the beacon/transcript']
  ])('is dropped when the row has %s', async (_name, metadata, detail) => {
    const h = harness(twoSessions([sessionRow(SESSION_A, { external_metadata: metadata })]))
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.stages.find((stage) => stage.stage === 'model')).toEqual({ stage: 'model', ok: false, detail })
    expect(ccrModelForTab('tab-1', 1)).toBeNull()
  })

  it('is dropped when a refresh fails', async () => {
    let fail = false
    const h = harness(
      apiRoutes({
        sessions: () => (fail ? reply(500, {}) : reply(200, sessionsReply([sessionRow(SESSION_A, { external_metadata: { model: 'claude-opus-5-5' } })]))),
        events: { [SESSION_A]: () => reply(200, sessionAPage) }
      })
    )
    await runCcrImagePipeline(input(), h.deps)
    fail = true
    await expect(refreshCcrModel('tab-1', 1, h.deps)).resolves.toEqual({ stage: 'model', ok: false, detail: 'HTTP 500' })
    expect(ccrModelForTab('tab-1', 1)).toBeNull()
  })
})
