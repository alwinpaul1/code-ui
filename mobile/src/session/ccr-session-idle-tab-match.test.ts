/**
 * Reported 2026-10-15 08:40 on 0.9.150: two work-profile Claude tabs, idle since the evening
 * before, never matched their Remote Control sessions, and a third took 12 seconds. The phone's
 * log (tabs masked as it masks them):
 *
 *   08:38:40.939 sessions: ok — 16 Remote Control sessions to compare (150 listed)   (tab e7b…e4a)
 *   08:38:43.389 match: ok — NexDash: none of 16 Remote Control sessions shares a message with this
 *                tab in its latest 200 events; asking the other accounts
 *   08:38:50.123 match: failed — none of 16 … in its latest 200 events               (tab e7b…e4a)
 *   08:39:40.964 sessions: ok — 16 Remote Control sessions to compare (150 listed)   (tab e7b…432)
 *   08:39:53.356 match: ok — NexDash: session cse…JD8 (28) shares 34 messages with this tab
 *   08:39:53.376 images: ok — 0 of 0 pictures found in 1 page of events
 *
 * What the desktop held (~/.claude-work transcripts, read 2026-10-15): "Tablet cab redesign"
 * (1a4ddd4b…, bridge session cse_…JD8) last wrote a message at 2026-10-14T19:25:19.158Z, "Pull from
 * main" (6bfef54c…) at 19:24:25.300Z, and the latter's transcript names THREE bridge sessions over
 * its life (…NWqu to 2026-10-07, …9Qts to 2026-10-08, …XntT since 2026-10-12): each restart of
 * `claude --resume` took a new one.
 *
 * Three defects, each pinned here:
 *  - the 16 compared were the connected ones, newest first, so an idle tab's session sat behind
 *    every busier session of the organization and was never read;
 *  - all 16 first pages were read at once, 100 events each (an event can carry a whole tool
 *    result): 12.4 s from list to match, the match found on the first page;
 *  - a tab whose window spans a resume shares messages with the conversation's earlier bridge
 *    session too, which read as "2 sessions share messages … not guessing".
 *
 * Message uuids and times are the transcripts' own; session ids keep the observed 28-character
 * form and suffix, the rest made up. Shapes are the recorded ones (fixtures/ccr-session-api-2026-10-14.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { CcrFetch, CcrFetchResponse } from './ccr-session-api'
import { CCR_CLOCK_SKEW_MS, newestTranscriptMessageAt, rankCcrCandidates } from './ccr-session-match'
import { ccrModelForTab, resetCcrModelForTests } from './ccr-session-model'
import {
  CCR_MATCH_FIRST_PAGE_SIZE,
  CCR_MATCH_WAVES,
  ccrSessionForTab,
  refreshCcrModel,
  resetCcrPipelineForTests,
  runCcrImagePipeline,
  type CcrPipelineDeps,
  type CcrPipelineInput
} from './ccr-session-pipeline'
import { assistantEvent, event, eventsReply, fakeAccounts, reply, sessionRow, sessionsReply, systemEvent } from './fixtures/ccr-session-api-2026-10-14'

const WORK_ACCOUNT = '77d1e0aa-0000-4000-8000-00000000a003'
const WORK_ORG = '2b9c44d1-0000-4000-8000-00000000b004'
const WORK_TOKEN = 'work-oauth-token-not-a-real-credential'

/** "Tablet cab redesign": its bridge session, and its newest four messages with their times. */
const TABLET = 'cse_01SeaaaaaaaaaaaaaaaaaJD8'
const TABLET_MESSAGES = [
  { id: '4016c1f7-9a49-4b18-80f6-664951332403', at: '2026-10-14T19:25:08.079Z' },
  { id: '92c88028-0707-4f1c-ab78-20ad2cb86e07', at: '2026-10-14T19:25:11.204Z' },
  { id: 'e13c0ffd-fa53-40e0-bbab-5d8620df85c5', at: '2026-10-14T19:25:13.659Z' },
  { id: '94ba7876-c341-4f52-b0f7-f3d0ab9336ae', at: '2026-10-14T19:25:19.158Z' }
]
const TABLET_NEWEST_AT = Date.parse('2026-10-14T19:25:19.158Z')

/** "Pull from main": its three bridge sessions, oldest first, and messages either side of the last restart. */
const PULL_NWQU = 'cse_01KhaaaaaaaaaaaaaaaaNWqu'
const PULL_9QTS = 'cse_0128aaaaaaaaaaaaaaaa9Qts'
const PULL_XNTT = 'cse_01BQaaaaaaaaaaaaaaaaXntT'
const BEFORE_RESTART = 'e9ccf49c-1b3c-4d8f-83fd-e5c3412db76d'
const AFTER_RESTART = ['844f91d0-e785-42d3-a54a-530fe99fa14d', '9333820c-1af7-4022-ac61-c0a27a2c3694', '13c4a358-b244-4920-a08a-8038e724ac45']

/** Busier sessions of the organization, connected and written this morning. */
const BUSY = Array.from({ length: 24 }, (_, n) => `cse_01Busy${String(n).padStart(2, '0')}aaaaaaaaaaaaaa`)
const OLD = Array.from({ length: 125 }, (_, n) => `cse_01Old${String(n).padStart(3, '0')}aaaaaaaaaaaaaa`)

/** The idle tab's turn as its session's newest events hold it: the messages, then the turn's tail. */
function tabletEvents(): Record<string, unknown>[] {
  return [
    event({ type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: 'f00d0001-0000-4000-8000-000000000001', session_id: TABLET }),
    event({ type: 'system', subtype: 'post_turn_summary', uuid: 'f00d0001-0000-4000-8000-000000000002', session_id: TABLET }),
    event({ type: 'result', subtype: 'success', uuid: 'f00d0001-0000-4000-8000-000000000003', session_id: TABLET }),
    assistantEvent(TABLET_MESSAGES[3]!.id, 'toolu_T4', '/tmp/t4.png'),
    event({ type: 'user', uuid: TABLET_MESSAGES[2]!.id, session_id: TABLET, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: 'ok' }] } }),
    assistantEvent(TABLET_MESSAGES[1]!.id, 'toolu_T2', '/tmp/t2.png')
  ]
}

/** The work organization's list as the API orders it, most recently active first, 150 rows over two pages. */
function workRows(tablet: Record<string, unknown> = {}): Record<string, unknown>[] {
  return [
    ...BUSY.map((id, n) => sessionRow(id, { last_event_at: `2026-10-15T08:${String(39 - n).padStart(2, '0')}:00Z` })),
    sessionRow(TABLET, { title: 'Tablet cab redesign', last_event_at: '2026-10-14T19:25:31Z', external_metadata: { model: 'claude-opus-5-5', effort_level: 'medium' }, ...tablet }),
    ...OLD.map((id, n) => sessionRow(id, { connection_status: 'disconnected', last_event_at: `2026-10-13T${String(23 - Math.floor(n / 6)).padStart(2, '0')}:${String(59 - (n % 6)).padStart(2, '0')}:00Z` }))
  ]
}

type Sent = { url: URL }

function harness(options: { rows?: Record<string, unknown>[]; events?: Record<string, (cursor: string | null) => CcrFetchResponse> } = {}) {
  const sent: Sent[] = []
  const rows = options.rows ?? workRows()
  const fetch: CcrFetch = async (raw) => {
    const url = new URL(raw)
    sent.push({ url })
    if (url.pathname === '/v1/code/sessions') {
      // Pages of the size asked for, and a cursor while rows remain.
      const limit = Number(url.searchParams.get('limit'))
      const from = Number(url.searchParams.get('cursor') ?? '0')
      const next = from + limit < rows.length ? String(from + limit) : null
      return reply(200, sessionsReply(rows.slice(from, from + limit), next))
    }
    const match = /^\/v1\/code\/sessions\/([^/]+)\/events$/.exec(url.pathname)
    if (match) {
      const page = options.events?.[match[1]!]
      return page ? page(url.searchParams.get('cursor')) : reply(200, eventsReply([systemEvent(`${match[1]}-sys`)]))
    }
    return reply(404, {})
  }
  const kept = fakeAccounts([{ id: WORK_ACCOUNT, label: 'NexDash', token: WORK_TOKEN, organizationUuid: WORK_ORG }])
  const lines: string[] = []
  const deps: CcrPipelineDeps = { fetch, accounts: kept.source, keep: (_key, uri) => uri, maxBytes: 8 * 1024 * 1024, log: (line) => lines.push(line) }
  return { deps, sent, lines }
}

const eventReads = (sent: Sent[]) => sent.filter((entry) => entry.url.pathname.endsWith('/events'))
const sessionOf = (entry: Sent) => decodeURIComponent(entry.url.pathname.split('/')[4]!)

const tablet = (overrides: Partial<CcrPipelineInput> = {}): CcrPipelineInput => ({
  tabId: 'tab-tablet',
  epoch: 1,
  messageIds: TABLET_MESSAGES.map((message) => message.id),
  newestMessageAt: TABLET_NEWEST_AT,
  configDir: '/Users/alwinpaul/.claude-work',
  wanted: { toolUseIds: [], userMessageIds: [] },
  ...overrides
})

beforeEach(() => {
  resetCcrPipelineForTests()
  resetCcrModelForTests()
})

describe('an idle work tab behind two dozen busier sessions', () => {
  it('matches its session and shows its model, where the 16 newest connected ones never held it', async () => {
    const h = harness({ events: { [TABLET]: () => reply(200, eventsReply(tabletEvents())) } })
    const result = await runCcrImagePipeline(tablet(), h.deps)
    expect(result.sessionId).toBe(TABLET)
    expect(ccrModelForTab('tab-tablet', 1)).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' })
  })

  it('reads its session first, in one wave of small first pages, and nothing after the match', async () => {
    const h = harness({ events: { [TABLET]: () => reply(200, eventsReply(tabletEvents())) } })
    await runCcrImagePipeline(tablet(), h.deps)
    const reads = eventReads(h.sent)
    expect(sessionOf(reads[0]!)).toBe(TABLET)
    expect(reads.length).toBeLessThanOrEqual(CCR_MATCH_WAVES[0])
    expect(reads.every((entry) => entry.url.searchParams.get('limit') === String(CCR_MATCH_FIRST_PAGE_SIZE))).toBe(true)
  })

  it('matches it too when Claude is not running there (disconnected) and the tab’s times are unknown', async () => {
    const h = harness({
      rows: workRows({ connection_status: 'disconnected' }),
      events: { [TABLET]: () => reply(200, eventsReply(tabletEvents())) }
    })
    const result = await runCcrImagePipeline(tablet({ newestMessageAt: null }), h.deps)
    expect(result.sessionId).toBe(TABLET)
  })

  it('finds the message one page down when the first holds only the turn’s tail', async () => {
    const tail = Array.from({ length: CCR_MATCH_FIRST_PAGE_SIZE }, (_, n) => systemEvent(`tail-${n}`))
    const h = harness({
      events: { [TABLET]: (cursor) => reply(200, cursor === null ? eventsReply(tail, 'older') : eventsReply(tabletEvents())) }
    })
    const result = await runCcrImagePipeline(tablet(), h.deps)
    expect(result.sessionId).toBe(TABLET)
    const tabletReads = eventReads(h.sent).filter((entry) => sessionOf(entry) === TABLET)
    expect(tabletReads.map((entry) => [entry.url.searchParams.get('cursor'), entry.url.searchParams.get('limit')])).toEqual([
      [null, String(CCR_MATCH_FIRST_PAGE_SIZE)],
      ['older', '100']
    ])
  })

  it('refuses, naming why, when a session of a later wave cannot be read', async () => {
    const h = harness({
      rows: workRows({ connection_status: 'disconnected' }),
      events: {
        [TABLET]: () => reply(200, eventsReply(tabletEvents())),
        // Read in the second wave: ranked after the four newest connected ones.
        [BUSY[6]!]: () => reply(500, {})
      }
    })
    const result = await runCcrImagePipeline(tablet({ newestMessageAt: null }), h.deps)
    expect(result.sessionId).toBeNull()
    expect(result.stages.at(-1)).toMatchObject({ stage: 'match', ok: false })
    expect(result.stages.at(-1)!.detail).toContain('not guessing')
    expect(h.lines.join('\n')).toContain('HTTP 500')
    expect(ccrSessionForTab('tab-tablet', 1)).toBeNull()
  })
})

describe('a tab whose window spans a restart of `claude --resume`', () => {
  const rows = () => [
    sessionRow(PULL_XNTT, { last_event_at: '2026-10-14T19:24:40Z', external_metadata: { model: 'claude-opus-5-5', effort_level: 'medium' } }),
    sessionRow(PULL_9QTS, { connection_status: 'disconnected', last_event_at: '2026-10-08T16:51:52Z' }),
    sessionRow(PULL_NWQU, { connection_status: 'disconnected', last_event_at: '2026-10-07T08:18:27Z' })
  ]
  const events = {
    // The earlier session's newest events end with the conversation as it stood before the restart.
    [PULL_9QTS]: () => reply(200, eventsReply([systemEvent('9qts-sys'), assistantEvent(BEFORE_RESTART, 'toolu_B', '/tmp/b.png')])),
    [PULL_XNTT]: () => reply(200, eventsReply([systemEvent('xntt-sys'), ...AFTER_RESTART.toReversed().map((uuid) => assistantEvent(uuid, `toolu_${uuid.slice(0, 4)}`, '/tmp/a.png'))]))
  }

  it('is the session that holds its newest messages, not "2 sessions share messages"', async () => {
    const h = harness({ rows: rows(), events })
    const result = await runCcrImagePipeline(
      tablet({ tabId: 'tab-pull', messageIds: [BEFORE_RESTART, ...AFTER_RESTART], newestMessageAt: Date.parse('2026-10-14T19:24:25.300Z') }),
      h.deps
    )
    expect(result.sessionId).toBe(PULL_XNTT)
  })

  it('still refuses two sessions that both hold its newest message', async () => {
    const h = harness({
      rows: rows(),
      events: { ...events, [PULL_9QTS]: () => reply(200, eventsReply([assistantEvent(AFTER_RESTART[2]!, 'toolu_F', '/tmp/f.png')])) }
    })
    const result = await runCcrImagePipeline(tablet({ tabId: 'tab-pull', messageIds: [BEFORE_RESTART, ...AFTER_RESTART], newestMessageAt: null }), h.deps)
    expect(result.sessionId).toBeNull()
    expect(result.stages.at(-1)!.detail).toContain('2 sessions share messages with this tab')
  })
})

describe('re-reading a matched tab’s model', () => {
  it('reads one page of the list when the session is on it, not every page', async () => {
    // The tab busy this time: its session the most recently active of the 150.
    const rows = workRows({ last_event_at: '2026-10-15T08:40:00Z' })
    const h = harness({ rows: [rows[BUSY.length]!, ...rows.filter((_, n) => n !== BUSY.length)], events: { [TABLET]: () => reply(200, eventsReply(tabletEvents())) } })
    await runCcrImagePipeline(tablet({ newestMessageAt: null }), h.deps)
    expect(ccrSessionForTab('tab-tablet', 1)).toBe(TABLET)
    const before = h.sent.length
    await refreshCcrModel('tab-tablet', 1, h.deps)
    const lists = h.sent.slice(before).filter((entry) => entry.url.pathname === '/v1/code/sessions')
    expect(lists).toHaveLength(1)
    expect(ccrModelForTab('tab-tablet', 1)).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' })
  })

  it('reads on to the next page for a session listed there, and drops a match listed on none', async () => {
    const rows = [...BUSY.map((id) => sessionRow(id)), ...OLD.slice(0, 80).map((id) => sessionRow(id)), sessionRow(TABLET, { last_event_at: '2026-10-14T23:00:00Z', external_metadata: { model: 'claude-opus-5-5', effort_level: 'high' } })]
    const h = harness({ rows, events: { [TABLET]: () => reply(200, eventsReply(tabletEvents())) } })
    await runCcrImagePipeline(tablet({ newestMessageAt: null }), h.deps)
    expect(ccrSessionForTab('tab-tablet', 1)).toBe(TABLET)
    const before = h.sent.length
    await refreshCcrModel('tab-tablet', 1, h.deps)
    expect(h.sent.slice(before).filter((entry) => entry.url.pathname === '/v1/code/sessions')).toHaveLength(2)
    expect(ccrModelForTab('tab-tablet', 1)).toMatchObject({ effort: 'high' })
    rows.pop()
    await refreshCcrModel('tab-tablet', 1, h.deps)
    expect(ccrSessionForTab('tab-tablet', 1)).toBeNull()
  })
})

describe('the order sessions are read in', () => {
  const row = (id: string, activeAt: number, connectionStatus = 'connected') => ({ row: { id, activeAt, connectionStatus } })
  const at = Date.parse('2026-10-14T19:25:19.158Z')

  it('puts the session nearest the tab’s newest message, and not before it, first', () => {
    const ranked = rankCcrCandidates([row('busy', Date.parse('2026-10-15T08:39:00Z')), row('tab', Date.parse('2026-10-14T19:25:31Z')), row('before', at - 2 * CCR_CLOCK_SKEW_MS)], at)
    expect(ranked.map((candidate) => candidate.row.id)).toEqual(['tab', 'busy', 'before'])
  })

  it('allows the host’s clock to run ahead of Anthropic’s by the skew', () => {
    const ranked = rankCcrCandidates([row('busy', at + 3_600_000), row('tab', at - CCR_CLOCK_SKEW_MS / 2)], at)
    expect(ranked[0]!.row.id).toBe('tab')
  })

  it('without a time, puts connected sessions first, newest first', () => {
    const ranked = rankCcrCandidates([row('off', 3, 'disconnected'), row('old', 1), row('new', 2)], null)
    expect(ranked.map((candidate) => candidate.row.id)).toEqual(['new', 'old', 'off'])
  })

  it('handles one session and none', () => {
    expect(rankCcrCandidates([row('only', 0)], at).map((candidate) => candidate.row.id)).toEqual(['only'])
    expect(rankCcrCandidates([], at)).toEqual([])
  })
})

describe('the tab’s newest transcript time', () => {
  it('is the newest of its transcript messages', () => {
    expect(newestTranscriptMessageAt(TABLET_MESSAGES.map((message) => ({ timestamp: Date.parse(message.at), source: 'transcript' as const })))).toBe(TABLET_NEWEST_AT)
  })

  it('leaves out a row that is not the transcript’s, and one with no time', () => {
    expect(
      newestTranscriptMessageAt([
        { timestamp: TABLET_NEWEST_AT, source: 'transcript' },
        { timestamp: Date.parse('2026-10-15T08:40:00Z'), source: 'scrape' },
        { timestamp: null, source: 'transcript' }
      ])
    ).toBe(TABLET_NEWEST_AT)
  })

  it('is null for no messages', () => {
    expect(newestTranscriptMessageAt([])).toBeNull()
  })
})
