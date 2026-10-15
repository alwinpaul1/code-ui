import { beforeEach, describe, expect, it } from 'vitest'
import { fetchCcrAccountUsage } from './ccr-session-api'
import { resetCcrCacheForTests, setCcrMapping } from './ccr-session-cache'
import {
  ccrContextOfEvents,
  ccrUsageForTab,
  noteCcrRowContext,
  CCR_USAGE_FRESH_MS,
  refreshCcrUsage,
  resetCcrUsageForTests
} from './ccr-session-usage'
import type { CcrPipelineDeps } from './ccr-session-shared'
import {
  eventsReply,
  event,
  fakeAccounts,
  fakeFetch,
  reply,
  type RecordedRequest,
  type Route
} from './fixtures/ccr-session-api-2026-10-14'

// The user, 2026-10-15: "if I'm on my work account, the context ring must show that account's usage
// and that exact session's context usage". Claude Code 2.1.300; the `usage` keys are those of a real
// assistant record in this machine's transcripts (session 211c47c2, claude-opus-5-5, taken
// 2026-10-15). The `result` event's `modelUsage[model].contextWindow` and `/api/oauth/usage`
// (`five_hour`/`seven_day`: `utilization` in percent, `resets_at`) are the shapes in the 2.1.300
// binary, not yet read from a live reply.

const WORK_SESSION = 'cse_01QXwwwwwwwwwwwwwwwwwwww'
const PERSONAL_SESSION = 'cse_01QXpppppppppppppppppppp'
const WORK = { id: 'acct-work', label: 'Work', token: 'tok-work', organizationUuid: 'org-work' }
const PERSONAL = { id: 'acct-personal', label: 'Personal', token: 'tok-personal', organizationUuid: 'org-personal' }

/** The usage keys of a real Claude Code assistant record (claude-opus-5-5). */
const realUsage = (tokens: { input: number; creation: number; read: number }) => ({
  input_tokens: tokens.input,
  cache_creation_input_tokens: tokens.creation,
  cache_read_input_tokens: tokens.read,
  output_tokens: 200,
  service_tier: 'standard'
})

const assistant = (tokens: { input: number; creation: number; read: number }, extra: Record<string, unknown> = {}, model = 'claude-opus-5-5') =>
  event({ type: 'assistant', uuid: `a-${tokens.read}`, isSidechain: false, message: { role: 'assistant', model, usage: realUsage(tokens), content: [] }, ...extra })

const result = (contextWindow: number, model = 'claude-opus-5-5') =>
  event({ type: 'result', subtype: 'success', modelUsage: { [model]: { inputTokens: 1, outputTokens: 1, contextWindow, maxOutputTokens: 64_000 } } })

const payloads = (events: Record<string, unknown>[]) => events.map((e) => ({ eventId: String(e.event_id), payload: e.payload as Record<string, unknown> }))

describe('the session context read from its events', () => {
  it('is the newest main-chain assistant turn: input + cache creation + cache read', () => {
    const context = ccrContextOfEvents(payloads([assistant({ input: 2, creation: 43_257, read: 29_286 }), assistant({ input: 1, creation: 10, read: 10 })]))
    expect(context).toEqual({ usedTokens: 72_545, windowTokens: null })
  })

  // Live 2026-10-15 (the work session): the `result` event's `modelUsage` is `{}`, so events never state a
  // window; a populated one must not become a denominator either (the row's context_usage is the source).
  it('states no window from events, whatever a result carries and whatever the model is called', () => {
    const context = ccrContextOfEvents(payloads([assistant({ input: 2, creation: 43_257, read: 29_286 }), result(1_000_000), event({ type: 'result', subtype: 'success', modelUsage: {} })]))
    expect(context).toEqual({ usedTokens: 72_545, windowTokens: null })
  })

  it('skips a sub-agent turn, which runs in a context of its own', () => {
    const context = ccrContextOfEvents(payloads([assistant({ input: 9, creation: 9, read: 9_000 }, { isSidechain: true }), assistant({ input: 2, creation: 100, read: 900 })]))
    expect(context?.usedTokens).toBe(1_002)
  })

  it('skips a synthetic turn with no usage', () => {
    const context = ccrContextOfEvents(payloads([assistant({ input: 0, creation: 0, read: 0 }, {}, '<synthetic>'), assistant({ input: 2, creation: 100, read: 900 })]))
    expect(context?.usedTokens).toBe(1_002)
  })

  it('is nothing for no events, and for events with no assistant turn', () => {
    expect(ccrContextOfEvents([])).toBeNull()
    expect(ccrContextOfEvents(payloads([event({ type: 'system', subtype: 'init' }), result(1_000_000)]))).toBeNull()
  })

  it('reads a session of one assistant event', () => {
    expect(ccrContextOfEvents(payloads([assistant({ input: 1, creation: 0, read: 0 })]))).toEqual({ usedTokens: 1, windowTokens: null })
  })
})

describe('the account usage reply', () => {
  const answer = (body: unknown) => fakeFetch([() => reply(200, body)]).fetch

  // Live 2026-10-15, both accounts, shapes only: five_hour 1 and seven_day 3 on the personal account.
  it('reads the live reply: percent numbers, ISO resets with microseconds and an offset, the rest null', async () => {
    const windows = await fetchCcrAccountUsage(
      answer({
        five_hour: { utilization: 1, resets_at: '2026-10-15T10:30:00.089221+00:00', limit_dollars: null, used_dollars: null, remaining_dollars: null, locked_reason: null },
        seven_day: { utilization: 3, resets_at: '2026-10-21T17:00:00.089241+00:00', limit_dollars: null, used_dollars: null, remaining_dollars: null, locked_reason: null },
        seven_day_opus: null,
        seven_day_sonnet: null,
        limits: [{ kind: 'session', group: 'session', percent: 1, severity: 'normal', resets_at: '2026-10-15T10:30:00.089221+00:00', scope: null, is_active: false }],
        extra_usage: { is_enabled: false }
      }),
      'tok'
    )
    expect(windows).toEqual([
      { name: 'Session', usedPercent: 1, windowMinutes: 300, resetsAt: Math.floor(Date.parse('2026-10-15T10:30:00.089Z') / 1000) },
      { name: 'Weekly', usedPercent: 3, windowMinutes: 10_080, resetsAt: Math.floor(Date.parse('2026-10-21T17:00:00.089Z') / 1000) }
    ])
  })

  it('reads the 5-hour and weekly windows as percent, with the reset', async () => {
    const windows = await fetchCcrAccountUsage(answer({ five_hour: { utilization: 37.4, resets_at: '2026-10-15T14:00:00Z' }, seven_day: { utilization: 61, resets_at: '2026-10-19T09:00:00Z' }, seven_day_opus: null }), 'tok')
    expect(windows).toEqual([
      { name: 'Session', usedPercent: 37.4, windowMinutes: 300, resetsAt: Date.parse('2026-10-15T14:00:00Z') / 1000 },
      { name: 'Weekly', usedPercent: 61, windowMinutes: 10_080, resetsAt: Date.parse('2026-10-19T09:00:00Z') / 1000 }
    ])
  })

  it('leaves a window the reply omits or nulls out, and a reply with none is no rows', async () => {
    expect(await fetchCcrAccountUsage(answer({ five_hour: null, seven_day: { utilization: 5, resets_at: null } }), 'tok')).toEqual([{ name: 'Weekly', usedPercent: 5, windowMinutes: 10_080, resetsAt: null }])
    expect(await fetchCcrAccountUsage(answer({}), 'tok')).toEqual([])
  })

  it('rejects a reply that is not an object, and a refused token', async () => {
    await expect(fetchCcrAccountUsage(answer([1]), 'tok')).rejects.toThrow('usage: malformed')
    await expect(fetchCcrAccountUsage(fakeFetch([() => reply(401, {})]).fetch, 'tok')).rejects.toThrow('usage: unauthorized')
  })

  it('sends the account’s own token and nothing of another', async () => {
    const { fetch, requests } = fakeFetch([() => reply(200, {})])
    await fetchCcrAccountUsage(fetch, 'tok-work')
    expect(requests[0]!.url).toBe('https://api.anthropic.com/api/oauth/usage')
    expect(requests[0]!.headers.Authorization).toBe('Bearer tok-work')
    expect(requests[0]!.headers['Anthropic-Beta']).toBeUndefined()
  })
})

describe('two tabs on two accounts, side by side', () => {
  beforeEach(() => {
    resetCcrCacheForTests()
    resetCcrUsageForTests()
    setCcrMapping('tab-work', WORK_SESSION, 1, WORK.id, 'claude-work-1')
    setCcrMapping('tab-personal', PERSONAL_SESSION, 1, PERSONAL.id, 'claude-personal-1')
  })

  /** Each account answers with its own plan windows; each session with its own events. */
  function world(overrides: { workUsage?: () => ReturnType<typeof reply> } = {}) {
    const routes: Route[] = [
      (url) => {
        const match = /^\/v1\/code\/sessions\/([^/]+)\/events$/.exec(url.pathname)
        if (!match) {
          return null
        }
        return decodeURIComponent(match[1]!) === WORK_SESSION
          ? reply(200, eventsReply([assistant({ input: 3, creation: 20_000, read: 60_000 })]))
          : reply(200, eventsReply([assistant({ input: 5, creation: 1_000, read: 3_000 })]))
      }
    ]
    const requests: RecordedRequest[] = []
    const base = fakeFetch(routes)
    const fetch: CcrPipelineDeps['fetch'] = async (url, init) => {
      const token = init.headers.Authorization
      if (new URL(url).pathname === '/api/oauth/usage') {
        requests.push({ url, method: init.method, headers: init.headers })
        if (token === 'Bearer tok-work') {
          return overrides.workUsage?.() ?? reply(200, { five_hour: { utilization: 88, resets_at: '2026-10-15T14:00:00Z' }, seven_day: { utilization: 40, resets_at: '2026-10-19T09:00:00Z' } })
        }
        return reply(200, { five_hour: { utilization: 3, resets_at: '2026-10-15T15:00:00Z' }, seven_day: { utilization: 10, resets_at: '2026-10-20T09:00:00Z' } })
      }
      return base.fetch(url, init)
    }
    const accounts = fakeAccounts([WORK, PERSONAL]).source
    const deps = { fetch, accounts, keep: () => '', maxBytes: 1, log: () => {} } as CcrPipelineDeps
    return { deps, requests, eventRequests: base.requests }
  }

  it('each tab holds its own account’s limits and its own session’s context', async () => {
    const { deps } = world()
    // The work row states its own context (Claude Code's external_metadata.context_usage); the personal
    // row states none, so its tokens come from its events and no window is invented.
    noteCcrRowContext('tab-work', 1, { id: WORK_SESSION, contextUsage: { usedTokens: 80_003, maxTokens: 1_000_000 } })
    noteCcrRowContext('tab-personal', 1, { id: PERSONAL_SESSION, contextUsage: null })
    await refreshCcrUsage('tab-work', 1, deps, 'claude-work-1', true)
    await refreshCcrUsage('tab-personal', 1, deps, 'claude-personal-1', true)
    const now = Date.now()
    const work = ccrUsageForTab('tab-work', 1, WORK_SESSION, WORK.id, now)
    const personal = ccrUsageForTab('tab-personal', 1, PERSONAL_SESSION, PERSONAL.id, now)
    expect(work?.limits?.map((row) => row.usedPercent)).toEqual([88, 40])
    expect(work?.context).toEqual({ usedTokens: 80_003, windowTokens: 1_000_000 })
    expect(personal?.limits?.map((row) => row.usedPercent)).toEqual([3, 10])
    expect(personal?.context).toEqual({ usedTokens: 4_005, windowTokens: null })
  })

  it('answers none for a tab asked under the other account or session', async () => {
    const { deps } = world()
    await refreshCcrUsage('tab-work', 1, deps, 'claude-work-1', true)
    expect(ccrUsageForTab('tab-work', 1, WORK_SESSION, PERSONAL.id)).toBeNull()
    expect(ccrUsageForTab('tab-work', 1, PERSONAL_SESSION, WORK.id)).toBeNull()
    expect(ccrUsageForTab('tab-work', 2, WORK_SESSION, WORK.id)).toBeNull()
  })

  it('stops answering once the reading is older than it is kept', async () => {
    const { deps } = world()
    await refreshCcrUsage('tab-work', 1, deps, 'claude-work-1', true)
    expect(ccrUsageForTab('tab-work', 1, WORK_SESSION, WORK.id, Date.now() + CCR_USAGE_FRESH_MS + 1_000)).toBeNull()
  })

  it('asks the matched account’s token only, never the other’s', async () => {
    const { deps, requests } = world()
    await refreshCcrUsage('tab-personal', 1, deps, 'claude-personal-1', true)
    expect(requests.map((request) => request.headers.Authorization)).toEqual(['Bearer tok-personal'])
  })

  it('leaves the context when the usage call is refused, and the limits unread', async () => {
    const { deps } = world({ workUsage: () => reply(401, {}) })
    noteCcrRowContext('tab-work', 1, { id: WORK_SESSION, contextUsage: { usedTokens: 80_003, maxTokens: 1_000_000 } })
    await refreshCcrUsage('tab-work', 1, deps, 'claude-work-1', true)
    const work = ccrUsageForTab('tab-work', 1, WORK_SESSION, WORK.id)
    expect(work?.limits).toBeNull()
    expect(work?.context?.usedTokens).toBe(80_003)
  })

  it('reads no events when a live source already states the context', async () => {
    const { deps, eventRequests } = world()
    noteCcrRowContext('tab-work', 1, { id: WORK_SESSION, contextUsage: null })
    await refreshCcrUsage('tab-work', 1, deps, 'claude-work-1', false)
    expect(eventRequests).toHaveLength(0)
    expect(ccrUsageForTab('tab-work', 1, WORK_SESSION, WORK.id)?.context).toBeNull()
  })

  it('invents nothing for an account that signed out: the reading is dropped', async () => {
    const { deps } = world()
    await refreshCcrUsage('tab-work', 1, deps, 'claude-work-1', true)
    const signedOut = { ...deps, accounts: fakeAccounts([PERSONAL]).source }
    await refreshCcrUsage('tab-work', 1, signedOut, 'claude-work-1', true)
    expect(ccrUsageForTab('tab-work', 1, WORK_SESSION, WORK.id)).toBeNull()
  })

  it('takes the row’s own statement over the events, with no events read', async () => {
    const { deps, eventRequests } = world()
    noteCcrRowContext('tab-work', 1, { id: WORK_SESSION, contextUsage: { usedTokens: 120_000, maxTokens: 200_000 } })
    await refreshCcrUsage('tab-work', 1, deps, 'claude-work-1', true)
    expect(ccrUsageForTab('tab-work', 1, WORK_SESSION, WORK.id)?.context).toEqual({ usedTokens: 120_000, windowTokens: 200_000 })
    expect(eventRequests).toHaveLength(0)
  })

  it('ignores a row statement kept for another session of the tab', async () => {
    const { deps } = world()
    noteCcrRowContext('tab-work', 1, { id: PERSONAL_SESSION, contextUsage: { usedTokens: 1, maxTokens: 2 } })
    await refreshCcrUsage('tab-work', 1, deps, 'claude-work-1', true)
    expect(ccrUsageForTab('tab-work', 1, WORK_SESSION, WORK.id)?.context).toEqual({ usedTokens: 80_003, windowTokens: null })
  })

  it('does nothing for a tab that is not matched', async () => {
    const { deps, requests } = world()
    await refreshCcrUsage('tab-unmatched', 1, deps, null, true)
    expect(requests).toHaveLength(0)
  })
})
