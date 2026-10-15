/**
 * The user runs Claude Code under two accounts on the desktop: the default profile and a work
 * profile, different accounts in different organizations. The sessions API shows a session only to
 * its own organization, so a work-profile tab's model pill read "Model" while the Claude app showed
 * "Opus 5.5 Medium" (2026-10-14). The phone now signs in to each account and looks a tab's session
 * up across all of them.
 *
 * Fixtures are the shapes the other CCR tests use (they came from live API responses); the two
 * accounts differ in token, organization and which sessions their list holds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CcrFetch, CcrFetchResponse } from './ccr-session-api'
import { ccrModelForTab, resetCcrModelForTests } from './ccr-session-model'
import {
  ccrMayRun,
  ccrSessionForTab,
  refreshCcrModel,
  resetCcrPipelineForTests,
  runCcrImagePipeline,
  setCcrSelfTestContext,
  type CcrPipelineDeps
} from './ccr-session-pipeline'
import { runCcrSelfTest } from './ccr-session-self-test'
import {
  ACCOUNT_UUID,
  ORG_UUID,
  SESSION_A,
  SESSION_B,
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

/** The work profile's tab: its messages are in SESSION_A, which only the work organization lists. */
const TAB_MESSAGES = ['fae82585-cd65-43d6-9e29-8d60e172685b', '4df636b3-e768-4dbf-a93b-30f0cc01b742']

const defaultSide = (): FakeAccount => defaultAccount({ label: 'Personal' })
const workSide = (): FakeAccount => ({ id: WORK_ACCOUNT, label: 'NexDash', token: WORK_TOKEN, organizationUuid: null })

/** Routes of the default account's organization: it lists a session that is not this tab's. */
const defaultRoutes = (overrides: Parameters<typeof apiRoutes>[0] = {}): Route[] =>
  apiRoutes({
    sessions: () => reply(200, sessionsReply([sessionRow(SESSION_B, { external_metadata: { model: 'claude-sonnet-5-5', effort_level: 'low' } })])),
    events: { [SESSION_B]: () => reply(200, eventsReply([systemEvent('someone-elses-1')])) },
    ...overrides
  })

/** Routes of the work account's organization: it lists this tab's session, with the model the Claude app shows. */
const workRoutes = (overrides: Parameters<typeof apiRoutes>[0] = {}): Route[] =>
  apiRoutes({
    profile: reply(200, { account: { uuid: WORK_ACCOUNT }, organization: { uuid: WORK_ORG, name: 'NexDash' } }),
    sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A, { external_metadata: { model: 'claude-opus-5-5', effort_level: 'medium' } })])),
    events: { [SESSION_A]: () => reply(200, eventsReply([assistantEvent(TAB_MESSAGES[0]!, 'toolu_W', '/tmp/work.png'), systemEvent('sys')])) },
    ...overrides
  })

type Sent = { url: string; token: string; organization: string | null }

/** A fetch that answers as the organization the Authorization header belongs to, and records who asked. */
function bothAccountsFetch(answers: Record<string, Route[] | Error>): { fetch: CcrFetch; sent: Sent[] } {
  const sent: Sent[] = []
  const fetch: CcrFetch = async (url, init) => {
    const token = init.headers.Authorization!.replace('Bearer ', '')
    sent.push({ url, token, organization: init.headers['X-Organization-Uuid'] ?? null })
    const answer = answers[token]
    if (answer instanceof Error) {
      throw answer
    }
    for (const route of answer ?? []) {
      const response: CcrFetchResponse | null = await route(new URL(url))
      if (response) {
        return response
      }
    }
    return reply(404, {})
  }
  return { fetch, sent }
}

function harness(accounts: FakeAccount[], answers: Record<string, Route[] | Error>) {
  const { fetch, sent } = bothAccountsFetch(answers)
  const kept = fakeAccounts(accounts)
  const lines: { line: string; ok: boolean }[] = []
  const deps: CcrPipelineDeps = {
    fetch,
    accounts: kept.source,
    keep: (_key, uri) => uri,
    maxBytes: 8 * 1024 * 1024,
    log: (line, ok) => lines.push({ line, ok })
  }
  return { deps, sent, lines, kept }
}

const input = () => ({ tabId: 'tab-1', epoch: 1, messageIds: TAB_MESSAGES, wanted: { toolUseIds: [], userMessageIds: [] } })
const bothAnswers = () => ({ [TOKEN]: defaultRoutes(), [WORK_TOKEN]: workRoutes() })

beforeEach(() => {
  resetCcrPipelineForTests()
  resetCcrModelForTests()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('a tab of the work account, with both accounts signed in', () => {
  it('a work-account session shows its model when both accounts are signed in', async () => {
    const h = harness([defaultSide(), workSide()], bothAnswers())

    const result = await runCcrImagePipeline(input(), h.deps)

    expect(result.sessionId).toBe(SESSION_A)
    expect(ccrModelForTab('tab-1', 1)).toMatchObject({ sessionId: SESSION_A, model: 'claude-opus-5-5', effort: 'medium' })
  })

  it("reads the work account's organization from its own profile, and keeps it", async () => {
    const h = harness([defaultSide(), workSide()], bothAnswers())
    await runCcrImagePipeline(input(), h.deps)
    expect(h.kept.accounts.map((account) => [account.id, account.organizationUuid])).toEqual([
      [ACCOUNT_UUID, ORG_UUID],
      [WORK_ACCOUNT, WORK_ORG]
    ])
    expect(h.sent.filter((request) => request.url.endsWith('/api/oauth/profile')).map((request) => request.token)).toEqual([TOKEN, WORK_TOKEN])
  })

  it('asks each organization for its own sessions with its own token', async () => {
    const h = harness([defaultSide(), workSide()], bothAnswers())
    await runCcrImagePipeline(input(), h.deps)
    const lists = h.sent.filter((request) => new URL(request.url).pathname === '/v1/code/sessions')
    expect(lists.map((request) => [request.token, request.organization])).toEqual([
      [TOKEN, ORG_UUID],
      [WORK_TOKEN, WORK_ORG]
    ])
  })

  it("re-reads the model with the matched account's token and organization, never the other's", async () => {
    const h = harness([defaultSide(), workSide()], bothAnswers())
    await runCcrImagePipeline(input(), h.deps)
    h.sent.length = 0

    const refreshed = await refreshCcrModel('tab-1', 1, h.deps)

    expect(refreshed).toMatchObject({ stage: 'model', ok: true, detail: 'model claude-opus-5-5, effort medium' })
    expect(h.sent.length).toBeGreaterThan(0)
    expect(new Set(h.sent.map((request) => `${request.token}/${request.organization}`))).toEqual(new Set([`${WORK_TOKEN}/${WORK_ORG}`]))
  })

  it('reads the matched session’s events with the work token on a later run', async () => {
    const h = harness([defaultSide(), workSide()], bothAnswers())
    await runCcrImagePipeline(input(), h.deps)
    h.sent.length = 0
    await runCcrImagePipeline({ ...input(), wanted: { toolUseIds: ['toolu_missing'], userMessageIds: [] } }, h.deps)
    expect(h.sent.length).toBeGreaterThan(0)
    expect(h.sent.every((request) => request.token === WORK_TOKEN && request.organization === WORK_ORG)).toBe(true)
  })

  it('a tab of the default account still matches under the default account', async () => {
    const h = harness([defaultSide(), workSide()], {
      [TOKEN]: defaultRoutes({
        sessions: () => reply(200, sessionsReply([sessionRow(SESSION_B, { external_metadata: { model: 'claude-sonnet-5-5', effort_level: 'low' } })])),
        events: { [SESSION_B]: () => reply(200, eventsReply([assistantEvent(TAB_MESSAGES[0]!, 'toolu_D', '/tmp/d.png')])) }
      }),
      [WORK_TOKEN]: workRoutes({ events: { [SESSION_A]: () => reply(200, eventsReply([systemEvent('other')])) } })
    })
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.sessionId).toBe(SESSION_B)
    expect(ccrModelForTab('tab-1', 1)).toMatchObject({ model: 'claude-sonnet-5-5' })
  })

  it('does not guess when both accounts hold a session that shares the tab’s messages', async () => {
    const shared = () => reply(200, eventsReply([assistantEvent(TAB_MESSAGES[0]!, 'toolu_X', '/tmp/x.png')]))
    const h = harness([defaultSide(), workSide()], {
      [TOKEN]: defaultRoutes({ events: { [SESSION_B]: shared } }),
      [WORK_TOKEN]: workRoutes({ events: { [SESSION_A]: shared } })
    })
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.sessionId).toBeNull()
    expect(result.stages.at(-1)).toMatchObject({ stage: 'match', ok: false })
    expect(result.stages.at(-1)!.detail).toContain('not guessing')
  })

  it('matches afresh when the account it matched under signs out', async () => {
    const h = harness([defaultSide(), workSide()], bothAnswers())
    await runCcrImagePipeline(input(), h.deps)
    expect(ccrSessionForTab('tab-1', 1)).toBe(SESSION_A)

    h.kept.accounts.splice(1, 1)
    const result = await runCcrImagePipeline(input(), h.deps)

    expect(result.sessionId).toBeNull()
    expect(ccrSessionForTab('tab-1', 1)).toBeNull()
    expect(result.stages.at(-1)).toMatchObject({ stage: 'match', ok: false })
  })

  it('says the matched account is gone when the model is re-read after it signed out', async () => {
    const h = harness([defaultSide(), workSide()], bothAnswers())
    await runCcrImagePipeline(input(), h.deps)
    h.kept.accounts.splice(1, 1)
    expect(await refreshCcrModel('tab-1', 1, h.deps)).toMatchObject({ ok: false, detail: 'the account this tab matched under is no longer signed in' })
    expect(ccrModelForTab('tab-1', 1)).toBeNull()
  })
})

describe('when one account cannot answer', () => {
  it("one account's 401 doesn't hide the other's session", async () => {
    const h = harness([defaultSide(), workSide()], { [TOKEN]: defaultRoutes({ sessions: () => reply(401, {}) }), [WORK_TOKEN]: workRoutes() })

    const result = await runCcrImagePipeline(input(), h.deps)

    expect(result.sessionId).toBe(SESSION_A)
    expect(ccrModelForTab('tab-1', 1)).toMatchObject({ model: 'claude-opus-5-5' })
    // The refused account is named with its reason, and its organization is asked for again next time.
    expect(h.lines).toContainEqual({
      ok: false,
      line: '[ccr-images] sessions: failed — Personal: the sign-in was refused (HTTP 401); sign in again in Anthropic accounts (tab tab… (5))'
    })
    expect(h.kept.forgotten).toEqual([ACCOUNT_UUID])
    expect(h.kept.accounts[1]!.organizationUuid).toBe(WORK_ORG)
  })

  it('a default account whose profile call fails on the network leaves the work session found, and says why', async () => {
    const h = harness([defaultSide(), workSide()], { [TOKEN]: new TypeError('Network request failed'), [WORK_TOKEN]: workRoutes() })
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.sessionId).toBe(SESSION_A)
    expect(h.lines).toContainEqual({
      ok: false,
      line: '[ccr-images] org: failed — Personal: network error (no answer from api.anthropic.com) (tab tab… (5))'
    })
  })

  it("an account whose token could not be refreshed is named, and the other still answers", async () => {
    const expired: FakeAccount = { ...defaultSide(), token: null, error: 'the sign-in expired and could not be refreshed; sign in to this account again in Voice settings' }
    const h = harness([expired, workSide()], bothAnswers())
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.sessionId).toBe(SESSION_A)
    expect(h.sent.some((request) => request.token === TOKEN)).toBe(false)
    expect(h.lines.map((entry) => entry.line)).toContain(
      '[ccr-images] sign-in: failed — Personal: the sign-in expired and could not be refreshed; sign in to this account again in Voice settings (tab tab… (5))'
    )
  })

  it("one account's events failing names that account, and matches nothing rather than guess the other's session", async () => {
    // SESSION_B could not be read, so it may share the tab's messages too: no pick, no cached mapping.
    const h = harness([defaultSide(), workSide()], { [TOKEN]: defaultRoutes({ events: { [SESSION_B]: () => reply(401, {}) } }), [WORK_TOKEN]: workRoutes() })
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.sessionId).toBeNull()
    expect(ccrSessionForTab('tab-1', 1)).toBeNull()
    expect(result.stages.at(-1)!.detail).toBe("1 of 2 Remote Control sessions could not be read, so any of them may be this tab's; not guessing")
    expect(h.lines).toContainEqual({
      ok: false,
      line: '[ccr-images] match: failed — Personal: the sign-in was refused (HTTP 401); sign in again in Anthropic accounts (tab tab… (5))'
    })
  })

  it('fails, naming every account, when none of them can answer', async () => {
    const h = harness([defaultSide(), workSide()], {
      [TOKEN]: defaultRoutes({ sessions: () => reply(401, {}) }),
      [WORK_TOKEN]: workRoutes({ sessions: () => reply(403, { error: { message: 'trusted device required' } }) })
    })
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.sessionId).toBeNull()
    const failed = result.stages.filter((stage) => !stage.ok).map((stage) => stage.detail)
    expect(failed).toHaveLength(2)
    expect(failed[0]).toContain('Personal: the sign-in was refused')
    expect(failed[1]).toContain('NexDash: this phone is not a trusted device')
    expect(ccrMayRun('tab-1', 1, Date.now() + 1_000)).toBe(false)
  })

  it('names no account when only one is signed in, as before', async () => {
    const h = harness([workSide()], { [WORK_TOKEN]: workRoutes({ sessions: () => reply(401, {}) }) })
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.stages.at(-1)).toEqual({ stage: 'sessions', ok: false, detail: 'the sign-in was refused (HTTP 401); sign in again in Anthropic accounts' })
  })
})

describe('with one account, or none', () => {
  it('with one account signed in, finds its session as it always did', async () => {
    const h = harness([workSide()], bothAnswers())
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.sessionId).toBe(SESSION_A)
    expect(h.sent.every((request) => request.token === WORK_TOKEN)).toBe(true)
    expect(result.stages.map((stage) => stage.detail).join('\n')).not.toContain('NexDash:')
  })

  it('with zero accounts, asks nothing and says to sign in', async () => {
    const h = harness([], bothAnswers())
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(h.sent).toEqual([])
    expect(result.stages).toEqual([{ stage: 'sign-in', ok: false, detail: 'not signed in to Anthropic on this phone (Settings → Anthropic accounts → Sign in)' }])
  })

  it('with zero accounts, re-reading the model asks nothing either', async () => {
    const h = harness([], bothAnswers())
    expect(await refreshCcrModel('tab-1', 1, h.deps)).toBeNull()
    expect(h.sent).toEqual([])
  })

  it('a session list with no Remote Control session says it looked on both accounts', async () => {
    const empty = () => reply(200, sessionsReply([]))
    const h = harness([defaultSide(), workSide()], { [TOKEN]: defaultRoutes({ sessions: empty }), [WORK_TOKEN]: workRoutes({ sessions: empty }) })
    const result = await runCcrImagePipeline(input(), h.deps)
    expect(result.stages.at(-1)!.detail).toContain('no Remote Control session on these 2 accounts (0 sessions listed)')
  })
})

describe('the "Check session images" self-test, with two accounts', () => {
  it('reports each account’s sign-in and organization, and the account the tab matched under', async () => {
    const h = harness([defaultSide(), workSide()], bothAnswers())
    setCcrSelfTestContext({ tabId: 'tab-1', epoch: 1, messageIds: TAB_MESSAGES, wanted: { toolUseIds: [], userMessageIds: [] } })

    const lines = await runCcrSelfTest(h.deps)

    expect(lines.map((line) => `${line.ok ? 'ok' : 'FAIL'} ${line.label}: ${line.detail}`)).toEqual(
      expect.arrayContaining([
        'ok Anthropic sign-in: Personal: signed in',
        'ok Anthropic sign-in: NexDash: signed in',
        `ok Organization: Personal: organization ${ORG_UUID.slice(0, 3)}…${ORG_UUID.slice(-3)} (${ORG_UUID.length}) (from /api/oauth/profile)`,
        `ok Organization: NexDash: organization ${WORK_ORG.slice(0, 3)}…${WORK_ORG.slice(-3)} (${WORK_ORG.length}) (from /api/oauth/profile)`,
        expect.stringMatching(/^ok This tab’s session: NexDash: session cse…aaa/),
        'ok Model and effort: model claude-opus-5-5, effort medium'
      ])
    )
  })

  it('reports an account that failed beside the one that answered', async () => {
    const h = harness([defaultSide(), workSide()], { [TOKEN]: defaultRoutes({ sessions: () => reply(401, {}) }), [WORK_TOKEN]: workRoutes() })
    setCcrSelfTestContext({ tabId: 'tab-1', epoch: 1, messageIds: TAB_MESSAGES, wanted: { toolUseIds: [], userMessageIds: [] } })
    const lines = await runCcrSelfTest(h.deps)
    expect(lines.filter((line) => !line.ok).map((line) => `${line.label}: ${line.detail}`)).toEqual([
      'Remote Control sessions: Personal: the sign-in was refused (HTTP 401); sign in again in Anthropic accounts'
    ])
    expect(lines.some((line) => line.ok && line.label === 'This tab’s session')).toBe(true)
  })
})

describe('a match the phone cannot be sure of (review of 2026-10-14)', () => {
  it('refuses to match when another session’s events could not be read, and caches nothing', async () => {
    // One account lists two sessions. SESSION_A shares the tab's messages; SESSION_B's events answer
    // 500, so B could have shared them too. Picking A would be a guess the cache then keeps.
    const h = harness([defaultSide()], {
      [TOKEN]: apiRoutes({
        sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A), sessionRow(SESSION_B)])),
        events: {
          [SESSION_A]: () => reply(200, eventsReply([assistantEvent(TAB_MESSAGES[0]!, 'toolu_A', '/tmp/a.png')])),
          [SESSION_B]: () => reply(500, {})
        }
      })
    })

    const result = await runCcrImagePipeline(input(), h.deps)

    expect(result.sessionId).toBeNull()
    expect(ccrSessionForTab('tab-1', 1)).toBeNull()
    expect(result.stages.at(-1)).toMatchObject({ stage: 'match', ok: false })
    expect(result.stages.at(-1)!.detail).toContain('not guessing')
    // The unreadable session's own reason is still logged.
    expect(h.lines.some((entry) => !entry.ok && entry.line.includes('match: failed') && entry.line.includes('500'))).toBe(true)
  })

  it('matches a session two accounts of the same organization both list, instead of calling it ambiguous', async () => {
    const sameOrgWork: FakeAccount = { ...workSide(), organizationUuid: ORG_UUID }
    const tabSession = () =>
      apiRoutes({
        sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A)])),
        events: { [SESSION_A]: () => reply(200, eventsReply([assistantEvent(TAB_MESSAGES[0]!, 'toolu_S', '/tmp/s.png')])) }
      })
    const h = harness([defaultSide(), sameOrgWork], { [TOKEN]: tabSession(), [WORK_TOKEN]: tabSession() })

    const result = await runCcrImagePipeline(input(), h.deps)

    expect(result.sessionId).toBe(SESSION_A)
    expect(ccrSessionForTab('tab-1', 1)).toBe(SESSION_A)
  })

  it('re-reads the model by refreshing only the account the tab matched under', async () => {
    const h = harness([defaultSide(), workSide()], bothAnswers())
    await runCcrImagePipeline(input(), h.deps)
    const asked: (string | undefined)[] = []
    const list = h.deps.accounts.list
    h.deps.accounts.list = async (only?: string) => {
      asked.push(only)
      return list(only)
    }

    await refreshCcrModel('tab-1', 1, h.deps)

    expect(asked).toEqual([WORK_ACCOUNT])
  })
})
