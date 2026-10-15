/**
 * Reported 2026-10-15 on 0.9.148: a work-profile tab (`CLAUDE_CONFIG_DIR=~/.claude-work claude
 * --resume`, NexOS-Mobile-wt/tablet-cab-redesign) showed the "Model" placeholder while the Claude
 * app showed the same session as "Opus 5.5 Medium", with both accounts signed in on the phone.
 *
 * What the desktop held at the time (read from ~/.claude-work's transcripts, ids masked): 28
 * Remote Control sessions written in the last day under the work profile, and the tab's own
 * (`cse_019…U6U`, recorded by Claude Code in its transcript as a `bridge-session` record) was the
 * SIXTH most recent: five sessions had written after it (01:54, 01:20, three at 01:17; the tab's at
 * 01:16). The pipeline compared only the four newest Remote Control sessions per account, so the
 * tab's session was never a candidate and nothing matched.
 *
 * And the user's bar for the match itself: "it must match the session when i open asap", for an
 * already running tab too, and "in eye blink". So these also pin: every account is asked at once,
 * one session list per account serves every tab, the candidates' events are read at once, a sign-in
 * or an opened tab does not wait out a back-off, a tab whose Claude session changed is matched
 * again, and a match made once for a Claude Code session is kept across a restart.
 *
 * Shapes are the recorded ones (fixtures/ccr-session-api-2026-10-14.ts); ids are made up in the
 * observed 28-character `cse_…` form.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'
import type { CcrFetch, CcrFetchResponse } from './ccr-session-api'
import { ccrModelForTab, resetCcrModelForTests } from './ccr-session-model'
import {
  CCR_MATCH_WAVES,
  ccrMayRun,
  ccrSessionForTab,
  hydrateCcrSessionMappings,
  refreshCcrModel,
  resetCcrPipelineForTests,
  restartCcrCacheForTests,
  runCcrImagePipeline,
  type CcrPipelineDeps,
  type CcrPipelineInput
} from './ccr-session-pipeline'
import {
  TOKEN,
  apiRoutes,
  assistantEvent,
  defaultAccount,
  eventsReply,
  fakeAccounts,
  reply,
  sessionRow,
  sessionsReply,
  systemEvent,
  type FakeAccount,
  type Route
} from './fixtures/ccr-session-api-2026-10-14'

const WORK_ACCOUNT = '77d1e0aa-0000-4000-8000-00000000a003'
const WORK_ORG = '2b9c44d1-0000-4000-8000-00000000b004'
const WORK_TOKEN = 'work-oauth-token-not-a-real-credential'
/** The tab's Claude Code session id (the transcript's file name, the hook's `session_id`). */
const CC_SESSION = 'e50745d9-3b6f-4381-9e9c-48cfb838fa5f'
const CC_SESSION_AFTER_CLEAR = '0b8e2d6c-1f4a-4c55-9a7e-2d3c4b5a6f70'

const TAB_SESSION = 'cse_019aaaaaaaaaaaaaaaaaaU6U'
const NEWER = ['cse_01QaaaaaaaaaaaaaaaaaaZ54', 'cse_01SaaaaaaaaaaaaaaaaaaJD8', 'cse_01BaaaaaaaaaaaaaaaaaantT', 'cse_01KaaaaaaaaaaaaaaaaaaWqu', 'cse_012aaaaaaaaaaaaaaaaaaQts']
const OLDER = ['cse_01HaaaaaaaaaaaaaaaaaaZ6L', 'cse_01XaaaaaaaaaaaaaaaaaaL3D']
const NEW_CC_SESSION = 'cse_01NaaaaaaaaaaaaaaaaaaNEW'

const TAB_MESSAGES = ['fae82585-cd65-43d6-9e29-8d60e172685b', '4df636b3-e768-4dbf-a93b-30f0cc01b742']
const AFTER_CLEAR_MESSAGES = ['9d1c0b2a-3e4f-4a5b-8c6d-7e8f9a0b1c2d']

const personal = (): FakeAccount => defaultAccount({ label: 'Personal' })
const work = (): FakeAccount => ({ id: WORK_ACCOUNT, label: 'NexDash', token: WORK_TOKEN, organizationUuid: WORK_ORG })

/** The work organization's list as it stood: five Remote Control sessions newer than the tab's. */
function workRows(): Record<string, unknown>[] {
  return [
    ...NEWER.map((id, index) => sessionRow(id, { last_event_at: `2026-10-15T01:${String(54 - index).padStart(2, '0')}:00Z` })),
    sessionRow(TAB_SESSION, { title: 'PR #12 tablet cab redesign', last_event_at: '2026-10-15T01:16:00Z', external_metadata: { model: 'claude-opus-5-5', effort_level: 'medium' } }),
    ...OLDER.map((id, index) => sessionRow(id, { connection_status: 'disconnected', last_event_at: `2026-10-14T22:0${8 - index}:00Z` })),
    sessionRow(NEW_CC_SESSION, { last_event_at: '2026-10-14T21:00:00Z', external_metadata: { model: 'claude-sonnet-5-5', effort_level: 'low' } })
  ]
}

function workRoutes(): Route[] {
  const events: Record<string, (cursor: string | null) => CcrFetchResponse> = {}
  for (const id of [...NEWER, ...OLDER]) {
    events[id] = () => reply(200, eventsReply([systemEvent(`${id}-sys`)]))
  }
  events[TAB_SESSION] = () => reply(200, eventsReply([systemEvent('tab-sys'), assistantEvent(TAB_MESSAGES[0]!, 'toolu_W', '/tmp/w.png')]))
  events[NEW_CC_SESSION] = () => reply(200, eventsReply([assistantEvent(AFTER_CLEAR_MESSAGES[0]!, 'toolu_N', '/tmp/n.png')]))
  return apiRoutes({ sessions: () => reply(200, sessionsReply(workRows())), events })
}

const personalRoutes = (): Route[] =>
  apiRoutes({
    sessions: () => reply(200, sessionsReply([sessionRow('cse_01PaaaaaaaaaaaaaaaaaaPRS')])),
    events: { cse_01PaaaaaaaaaaaaaaaaaaPRS: () => reply(200, eventsReply([systemEvent('personal-sys')])) }
  })

type Sent = { url: string; token: string; startedAt: number }

/** Answers as the organization the token belongs to; `gate` holds a reply until it resolves. */
function harness(accounts: FakeAccount[], options: { gate?: (sent: Sent, all: Sent[]) => Promise<void> } = {}) {
  const sent: Sent[] = []
  const answers: Record<string, Route[]> = { [TOKEN]: personalRoutes(), [WORK_TOKEN]: workRoutes() }
  const resolvedOrder: string[] = []
  let clock = 0
  const fetch: CcrFetch = async (url, init) => {
    const token = init.headers.Authorization!.replace('Bearer ', '')
    const entry = { url, token, startedAt: clock++ }
    sent.push(entry)
    await options.gate?.(entry, sent)
    for (const route of answers[token] ?? []) {
      const response = await route(new URL(url))
      if (response) {
        resolvedOrder.push(url)
        return response
      }
    }
    return reply(404, {})
  }
  const kept = fakeAccounts(accounts)
  const lines: string[] = []
  const deps: CcrPipelineDeps = { fetch, accounts: kept.source, keep: (_key, uri) => uri, maxBytes: 8 * 1024 * 1024, log: (line) => lines.push(line) }
  return { deps, sent, lines, kept, resolvedOrder }
}

const input = (overrides: Partial<CcrPipelineInput> = {}): CcrPipelineInput => ({
  tabId: 'tab-work',
  epoch: 1,
  messageIds: TAB_MESSAGES,
  agentSessionId: CC_SESSION,
  wanted: { toolUseIds: [], userMessageIds: [] },
  ...overrides
})

const lists = (sent: Sent[]) => sent.filter((entry) => new URL(entry.url).pathname === '/v1/code/sessions')
const eventReads = (sent: Sent[]) => sent.filter((entry) => entry.url.includes('/events'))

beforeEach(() => {
  resetCcrPipelineForTests()
  resetCcrModelForTests()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('the reported tab: its session is not among the newest few', () => {
  it('matches the work tab’s session when five newer Remote Control sessions are listed before it, and shows its model', async () => {
    const h = harness([personal(), work()])
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.sessionId).toBe(TAB_SESSION)
    expect(ccrModelForTab('tab-work', 1)).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' })
  })

  it('reads a disconnected session only after the connected ones, newest first', async () => {
    const h = harness([work()])
    await runCcrImagePipeline(input({ messageIds: ['nothing-shared'] }), h.deps)
    const asked = [...new Set(eventReads(h.sent).map((entry) => new URL(entry.url).pathname.split('/')[4]))]
    expect(asked.slice(0, 6)).toEqual([...NEWER, TAB_SESSION])
    expect(asked.indexOf(OLDER[0]!)).toBeGreaterThan(asked.indexOf(TAB_SESSION))
  })
})

describe('in an eye blink', () => {
  it('asks every account for its sessions at once: both list calls start before either is answered', async () => {
    let startedWhenFirstAnswered = 0
    const h = harness([personal(), work()], {
      gate: async (entry, all) => {
        if (new URL(entry.url).pathname !== '/v1/code/sessions') {
          return
        }
        // Hold every list reply a few ticks: an account asked only after another answered starts late.
        for (let tick = 0; tick < 20 && lists(all).length < 2; tick += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
        if (startedWhenFirstAnswered === 0) {
          startedWhenFirstAnswered = lists(all).length
        }
      }
    })
    await runCcrImagePipeline(input(), h.deps)
    expect(startedWhenFirstAnswered).toBe(2)
  })

  it('reads a wave of candidates’ newest events at once, not one session after another', async () => {
    let startedWhenFirstAnswered = 0
    const h = harness([work()], {
      gate: async (entry, all) => {
        if (!entry.url.includes('/events')) {
          return
        }
        for (let tick = 0; tick < 20 && eventReads(all).length < CCR_MATCH_WAVES[0]; tick += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
        if (startedWhenFirstAnswered === 0) {
          startedWhenFirstAnswered = eventReads(all).length
        }
      }
    })
    await runCcrImagePipeline(input(), h.deps)
    expect(startedWhenFirstAnswered).toBe(CCR_MATCH_WAVES[0])
  })

  it('lists each account once for three tabs opened together, not once per tab', async () => {
    const h = harness([personal(), work()])
    await Promise.all([
      runCcrImagePipeline(input({ tabId: 'tab-1' }), h.deps),
      runCcrImagePipeline(input({ tabId: 'tab-2', agentSessionId: CC_SESSION_AFTER_CLEAR, messageIds: AFTER_CLEAR_MESSAGES }), h.deps),
      runCcrImagePipeline(input({ tabId: 'tab-3', messageIds: ['unmatched'] , agentSessionId: null }), h.deps)
    ])
    expect(lists(h.sent).filter((entry) => entry.token === TOKEN)).toHaveLength(1)
    expect(lists(h.sent).filter((entry) => entry.token === WORK_TOKEN)).toHaveLength(1)
    expect(ccrSessionForTab('tab-1', 1)).toBe(TAB_SESSION)
    expect(ccrSessionForTab('tab-2', 1)).toBe(NEW_CC_SESSION)
  })
})

describe('nothing waits once something changed', () => {
  it('matches the work session at once when the work account signs in after the tab failed, without waiting out the back-off', async () => {
    const h = harness([personal()])
    const failed = await runCcrImagePipeline(input(), h.deps)
    expect(failed.sessionId).toBeNull()
    expect(ccrMayRun('tab-work', 1)).toBe(false)

    h.kept.accounts.push(work())
    notifyAnthropicAccountsChanged()
    expect(ccrMayRun('tab-work', 1)).toBe(true)
    const matched = await runCcrImagePipeline(input(), h.deps)
    expect(matched.sessionId).toBe(TAB_SESSION)
  })

  it('lists the accounts afresh after a sign-in, not from the list shared before it', async () => {
    const h = harness([personal()])
    await runCcrImagePipeline(input(), h.deps)
    h.kept.accounts.push(work())
    notifyAnthropicAccountsChanged()
    await runCcrImagePipeline(input(), h.deps)
    expect(lists(h.sent).filter((entry) => entry.token === TOKEN)).toHaveLength(2)
  })

  it('matches again at once when the tab’s Claude session changes under it (/clear, --resume of another)', async () => {
    const h = harness([work()])
    await runCcrImagePipeline(input(), h.deps)
    expect(ccrSessionForTab('tab-work', 1, CC_SESSION)).toBe(TAB_SESSION)

    // The old match does not stand for the new Claude session.
    expect(ccrSessionForTab('tab-work', 1, CC_SESSION_AFTER_CLEAR)).toBeNull()
    const again = await runCcrImagePipeline(input({ agentSessionId: CC_SESSION_AFTER_CLEAR, messageIds: AFTER_CLEAR_MESSAGES }), h.deps)
    expect(again.sessionId).toBe(NEW_CC_SESSION)
    expect(ccrModelForTab('tab-work', 1)).toMatchObject({ model: 'claude-sonnet-5-5' })
  })
})

describe('a match is kept for its Claude Code session', () => {
  it('after a restart, takes the kept match and reads no session’s events to find it again', async () => {
    const h = harness([personal(), work()])
    await runCcrImagePipeline(input(), h.deps)
    await restartCcrCacheForTests()
    await hydrateCcrSessionMappings()

    // Before any request: the tab's session is known on the first frame.
    const before = h.sent.length
    expect(ccrSessionForTab('tab-work', 7, CC_SESSION)).toBe(TAB_SESSION)
    await refreshCcrModel('tab-work', 7, h.deps, CC_SESSION)
    const after = h.sent.slice(before)
    expect(eventReads(after)).toHaveLength(0)
    expect(after.every((entry) => entry.token === WORK_TOKEN)).toBe(true)
    expect(ccrModelForTab('tab-work', 7)).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' })
  })

  it('does not take a kept match for another Claude session in the same tab', async () => {
    const h = harness([work()])
    await runCcrImagePipeline(input(), h.deps)
    await restartCcrCacheForTests()
    await hydrateCcrSessionMappings()
    expect(ccrSessionForTab('tab-work', 7, CC_SESSION_AFTER_CLEAR)).toBeNull()
  })

  it('does not take a kept match whose account has signed out, and matches afresh', async () => {
    const h = harness([personal(), work()])
    await runCcrImagePipeline(input(), h.deps)
    await restartCcrCacheForTests()
    await hydrateCcrSessionMappings()
    h.kept.accounts.splice(1, 1)
    const result = await runCcrImagePipeline(input({ epoch: 7 }), h.deps)
    expect(result.sessionId).toBeNull()
    expect(ccrSessionForTab('tab-work', 7, CC_SESSION)).toBeNull()
  })

  it('lets go of a kept match whose account signed out when the model is re-read, so the next run matches afresh', async () => {
    const h = harness([personal(), work()])
    await runCcrImagePipeline(input(), h.deps)
    await restartCcrCacheForTests()
    await hydrateCcrSessionMappings()
    h.kept.accounts.splice(1, 1)
    expect(ccrSessionForTab('tab-work', 7, CC_SESSION)).toBe(TAB_SESSION)
    const refreshed = await refreshCcrModel('tab-work', 7, h.deps, CC_SESSION)
    expect(refreshed).toMatchObject({ stage: 'model', ok: false, detail: 'the account this tab matched under is no longer signed in' })
    expect(ccrSessionForTab('tab-work', 7, CC_SESSION)).toBeNull()
  })

  it('drops a kept match whose session is no longer listed', async () => {
    const h = harness([work()])
    await runCcrImagePipeline(input(), h.deps)
    await restartCcrCacheForTests()
    await hydrateCcrSessionMappings()
    const gone = harness([work()])
    gone.deps.fetch = (async (url: string, init: Parameters<CcrFetch>[1]) =>
      new URL(url).pathname === '/v1/code/sessions' ? reply(200, sessionsReply([])) : h.deps.fetch(url, init)) as CcrFetch
    await refreshCcrModel('tab-work', 7, gone.deps, CC_SESSION)
    expect(ccrSessionForTab('tab-work', 7, CC_SESSION)).toBeNull()
  })

  it('keeps nothing for a tab whose Claude session is not known', async () => {
    const h = harness([work()])
    await runCcrImagePipeline(input({ agentSessionId: null }), h.deps)
    await restartCcrCacheForTests()
    await hydrateCcrSessionMappings()
    expect(ccrSessionForTab('tab-work', 7, null)).toBeNull()
  })
})
