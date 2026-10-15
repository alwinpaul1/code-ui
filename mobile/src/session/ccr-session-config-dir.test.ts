/**
 * "When I open a new tab on desktop and open claude, that session must match with the correct
 * profile, like Remote Control. A tab started with `claude` is personal; one started with
 * `claudeai` (CLAUDE_CONFIG_DIR=~/.claude-work) is work." (2026-10-15)
 *
 * The tab's Claude config dir is in the transcript path Orca reports for it
 * (`~/.claude/projects/…` against `~/.claude-work/projects/…`), so nothing is set up on the desktop.
 * The account a config dir's tab was last matched under is asked first for that dir's next tab;
 * the tab still binds only on its own match, and the other accounts are asked when the bound one
 * does not hold the session.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { notifyAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'
import type { CcrFetch, CcrFetchResponse } from './ccr-session-api'
import { bindCcrConfigDir, ccrAccountForConfigDir } from './ccr-session-cache'
import { forgetSharedCcrLists } from './ccr-session-lists'
import { resetCcrModelForTests } from './ccr-session-model'
import {
  ccrSessionForTab,
  hydrateCcrSessionMappings,
  resetCcrPipelineForTests,
  restartCcrCacheForTests,
  runCcrImagePipeline,
  type CcrPipelineDeps,
  type CcrPipelineInput
} from './ccr-session-pipeline'
import {
  ACCOUNT_UUID,
  ORG_UUID,
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

const PERSONAL_DIR = '/Users/alwinpaul/.claude'
const WORK_DIR = '/Users/alwinpaul/.claude-work'

/** Each account's organization lists its own sessions; every session carries one tab's message. */
const SESSIONS = {
  personalA: { id: 'cse_01PaaaaaaaaaaaaaaaaaaPA1', message: '11111111-1111-4111-8111-111111111111', account: 'personal' },
  personalB: { id: 'cse_01PaaaaaaaaaaaaaaaaaaPB2', message: '22222222-2222-4222-8222-222222222222', account: 'personal' },
  workA: { id: 'cse_01WaaaaaaaaaaaaaaaaaaWA1', message: '33333333-3333-4333-8333-333333333333', account: 'work' },
  workB: { id: 'cse_01WaaaaaaaaaaaaaaaaaaWB2', message: '44444444-4444-4444-8444-444444444444', account: 'work' }
} as const

function routesFor(account: 'personal' | 'work'): Route[] {
  const mine = Object.values(SESSIONS).filter((session) => session.account === account)
  const events: Record<string, () => CcrFetchResponse> = {}
  for (const session of mine) {
    events[session.id] = () => reply(200, eventsReply([systemEvent(`${session.id}-sys`), assistantEvent(session.message, `toolu_${session.id}`, '/x.png')]))
  }
  return apiRoutes({ sessions: () => reply(200, sessionsReply(mine.map((session) => sessionRow(session.id)))), events })
}

type Sent = { url: string; token: string }

function harness(accounts: FakeAccount[]) {
  const sent: Sent[] = []
  const answers: Record<string, Route[]> = { [TOKEN]: routesFor('personal'), [WORK_TOKEN]: routesFor('work') }
  const fetch: CcrFetch = async (url, init) => {
    const token = init.headers.Authorization!.replace('Bearer ', '')
    sent.push({ url, token })
    for (const route of answers[token] ?? []) {
      const response = await route(new URL(url))
      if (response) {
        return response
      }
    }
    return reply(404, {})
  }
  const kept = fakeAccounts(accounts)
  const deps: CcrPipelineDeps = { fetch, accounts: kept.source, keep: (_key, uri) => uri, maxBytes: 1, log: () => undefined }
  return { deps, sent, kept }
}

const personal = (): FakeAccount => defaultAccount({ label: 'Personal', organizationUuid: ORG_UUID })
const work = (): FakeAccount => ({ id: WORK_ACCOUNT, label: 'NexDash', token: WORK_TOKEN, organizationUuid: WORK_ORG })

function tab(id: string, session: (typeof SESSIONS)[keyof typeof SESSIONS], configDir: string): CcrPipelineInput {
  return { tabId: id, epoch: 1, agentSessionId: `${id}-cc-session`, configDir, messageIds: [session.message], wanted: { toolUseIds: [], userMessageIds: [] } }
}

/** Learns both bindings the way the phone does: one tab of each profile matched once. */
async function learnBoth(h: ReturnType<typeof harness>): Promise<void> {
  await runCcrImagePipeline(tab('personal-1', SESSIONS.personalA, PERSONAL_DIR), h.deps)
  await runCcrImagePipeline(tab('work-1', SESSIONS.workA, WORK_DIR), h.deps)
  forgetSharedCcrLists()
  h.sent.length = 0
}

beforeEach(() => {
  resetCcrPipelineForTests()
  resetCcrModelForTests()
})

describe('a tab’s Claude config dir names the account to ask first', () => {
  it('learns which account each config dir belongs to from the first match of each', async () => {
    const h = harness([personal(), work()])
    await learnBoth(h)
    expect(ccrAccountForConfigDir(PERSONAL_DIR)).toBe(ACCOUNT_UUID)
    expect(ccrAccountForConfigDir(WORK_DIR)).toBe(WORK_ACCOUNT)
  })

  it('binds a personal and a work tab opened side by side to their own accounts on the first attempt, each asking only its own', async () => {
    const h = harness([personal(), work()])
    await learnBoth(h)

    const workRun = await runCcrImagePipeline(tab('work-2', SESSIONS.workB, WORK_DIR), h.deps)
    expect(workRun.sessionId).toBe(SESSIONS.workB.id)
    expect(h.sent.every((entry) => entry.token === WORK_TOKEN)).toBe(true)

    h.sent.length = 0
    forgetSharedCcrLists()
    const personalRun = await runCcrImagePipeline(tab('personal-2', SESSIONS.personalB, PERSONAL_DIR), h.deps)
    expect(personalRun.sessionId).toBe(SESSIONS.personalB.id)
    expect(h.sent.every((entry) => entry.token === TOKEN)).toBe(true)
  })

  it('asks a new work tab’s account first: its first request goes to the work organization', async () => {
    const h = harness([personal(), work()])
    await learnBoth(h)
    await runCcrImagePipeline(tab('work-3', SESSIONS.workB, WORK_DIR), h.deps)
    expect(h.sent[0]!.token).toBe(WORK_TOKEN)
  })

  it('takes the binding as a hint, not proof: a tab its bound account does not hold is found in the other, and the binding follows the match', async () => {
    const h = harness([personal(), work()])
    bindCcrConfigDir(WORK_DIR, ACCOUNT_UUID)
    const result = await runCcrImagePipeline(tab('work-4', SESSIONS.workA, WORK_DIR), h.deps)
    expect(result.sessionId).toBe(SESSIONS.workA.id)
    expect(h.sent[0]!.token).toBe(TOKEN)
    expect(h.sent.some((entry) => entry.token === WORK_TOKEN)).toBe(true)
    expect(ccrAccountForConfigDir(WORK_DIR)).toBe(WORK_ACCOUNT)
  })

  it('asks every account at once for a tab whose config dir is not bound yet', async () => {
    const h = harness([personal(), work()])
    await runCcrImagePipeline(tab('work-5', SESSIONS.workA, WORK_DIR), h.deps)
    expect(new Set(h.sent.map((entry) => entry.token))).toEqual(new Set([TOKEN, WORK_TOKEN]))
  })

  it('keeps the bindings across a restart', async () => {
    const h = harness([personal(), work()])
    await learnBoth(h)
    await restartCcrCacheForTests()
    await hydrateCcrSessionMappings()
    expect(ccrAccountForConfigDir(WORK_DIR)).toBe(WORK_ACCOUNT)
  })

  it('drops a binding when its account signs out, and keeps the other account’s', async () => {
    const h = harness([personal(), work()])
    await learnBoth(h)
    notifyAnthropicAccountsChanged({ signedOut: WORK_ACCOUNT })
    expect(ccrAccountForConfigDir(WORK_DIR)).toBeNull()
    expect(ccrAccountForConfigDir(PERSONAL_DIR)).toBe(ACCOUNT_UUID)
    notifyAnthropicAccountsChanged({ signedOut: 'all' })
    expect(ccrAccountForConfigDir(PERSONAL_DIR)).toBeNull()
  })

  it('does not bind a tab that matched nothing', async () => {
    const h = harness([personal(), work()])
    await runCcrImagePipeline({ ...tab('lost', SESSIONS.workA, WORK_DIR), messageIds: ['not-a-message'] }, h.deps)
    expect(ccrAccountForConfigDir(WORK_DIR)).toBeNull()
    expect(ccrSessionForTab('lost', 1)).toBeNull()
  })
})
