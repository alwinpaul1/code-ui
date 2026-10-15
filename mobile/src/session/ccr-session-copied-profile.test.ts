/**
 * "Currently using personal profile in both sessions still showing usage limit reset thingy"
 * (user, 2026-10-15): a personal Claude tab drew the WORK account's "Limit reached · Resets
 * Saturday at 2:59 am".
 *
 * The shape, read from the desktop and the phone's log that day: Orca pane 90bb…5855 ran Claude
 * session e50745d9 on the WORK profile (`~/.claude-work`, Remote Control session cse_019B…) until
 * 11:48:57Z. The session was then copied to `~/.claude` and resumed in the SAME pane with plain
 * `claude --resume` (no CLAUDE_CONFIG_DIR, so PERSONAL), which took a new personal Remote Control
 * session (cse_01Nm…). Same pane, same Claude session id: the phone's kept match for
 * `<pane>\0e50745d9` still named the work session, so the tab was read from it with no request
 * ("[ccr-usage] ok — NexDash: …" for the pane, 14:14-14:20), and that session's newest
 * `rate_limit_event` is the work account's rejected weekly limit. A fresh match was right: the
 * sibling pane (`--resume prs`, also copied) re-matched that day to its personal session.
 *
 * The tab's config dir is part of the match: a match made while the session wrote under another
 * config dir is not this tab's any more.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { CcrFetch, CcrFetchResponse } from './ccr-session-api'
import { bindCcrConfigDir, ccrAccountForTab, setCcrMapping } from './ccr-session-cache'
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
import { ACCOUNT_UUID, ORG_UUID, TOKEN, apiRoutes, assistantEvent, defaultAccount, eventsReply, fakeAccounts, reply, sessionRow, sessionsReply, type FakeAccount, type Route } from './fixtures/ccr-session-api-2026-10-14'

const WORK_ACCOUNT = '77d1e0aa-0000-4000-8000-00000000a003'
const WORK_ORG = '2b9c44d1-0000-4000-8000-00000000b004'
const WORK_TOKEN = 'work-oauth-token-not-a-real-credential'

const PERSONAL_DIR = '/Users/alwinpaul/.claude'
const WORK_DIR = '/Users/alwinpaul/.claude-work'

/** The pane and the Claude session that moved profiles (ids in the observed shapes, made up). */
const PANE = '90bb42e6-0000-4000-8000-000000005855'
const CLAUDE_SESSION = 'e50745d9-0000-4000-8000-0000000000f5'
/** The work profile's Remote Control session: the conversation up to the copy. */
const WORK_CSE = 'cse_019Baaaaaaaaaaaaaaaaaaaa'
/** The personal profile's, taken at the resume: what came after it. */
const PERSONAL_CSE = 'cse_01Nmaaaaaaaaaaaaaaaaaaaa'

const OLD_1 = '11111111-1111-4111-8111-111111111111'
const OLD_2 = '22222222-2222-4222-8222-222222222222'
const NEW_1 = '33333333-3333-4333-8333-333333333333'

function routes(sessions: Record<string, string[]>): Route[] {
  const events: Record<string, () => CcrFetchResponse> = {}
  for (const [id, uuids] of Object.entries(sessions)) {
    // Newest first, as the events API answers sort_order=desc.
    events[id] = () => reply(200, eventsReply(uuids.toReversed().map((uuid) => assistantEvent(uuid, `toolu_${uuid.slice(0, 8)}`, '/x.png'))))
  }
  return apiRoutes({ sessions: () => reply(200, sessionsReply(Object.keys(sessions).map((id) => sessionRow(id)))), events })
}

function harness(personalHolds: string[] = [NEW_1]) {
  const sent: string[] = []
  const answers: Record<string, Route[]> = {
    [TOKEN]: routes({ [PERSONAL_CSE]: personalHolds }),
    [WORK_TOKEN]: routes({ [WORK_CSE]: [OLD_1, OLD_2] })
  }
  const fetch: CcrFetch = async (url, init) => {
    const token = init.headers.Authorization!.replace('Bearer ', '')
    sent.push(token)
    for (const route of answers[token] ?? []) {
      const response = await route(new URL(url))
      if (response) {
        return response
      }
    }
    return reply(404, {})
  }
  const accounts: FakeAccount[] = [
    defaultAccount({ label: 'Account 1', organizationUuid: ORG_UUID }),
    { id: WORK_ACCOUNT, label: 'NexDash', token: WORK_TOKEN, organizationUuid: WORK_ORG }
  ]
  const deps: CcrPipelineDeps = { fetch, accounts: fakeAccounts(accounts).source, keep: (_key, uri) => uri, maxBytes: 1, log: () => undefined }
  return { deps, sent }
}

function run(configDir: string | null, messageIds: string[]): CcrPipelineInput {
  return { tabId: PANE, epoch: 1, agentSessionId: CLAUDE_SESSION, configDir, messageIds, wanted: { toolUseIds: [], userMessageIds: [] } }
}

beforeEach(() => {
  resetCcrPipelineForTests()
  resetCcrModelForTests()
})

describe('a Claude session copied from the work profile to the personal one and resumed in the same pane', () => {
  it('reads the personal session, not the work session the pane was matched to before the copy', async () => {
    const h = harness()
    const before = await runCcrImagePipeline(run(WORK_DIR, [OLD_1, OLD_2]), h.deps)
    expect(before.sessionId).toBe(WORK_CSE)
    forgetSharedCcrLists()

    // The copy keeps the old lines; the resume adds new ones under the personal profile.
    const after = await runCcrImagePipeline(run(PERSONAL_DIR, [OLD_1, OLD_2, NEW_1]), h.deps)
    expect(after.sessionId).toBe(PERSONAL_CSE)
    expect(ccrAccountForTab(PANE, 1, CLAUDE_SESSION, PERSONAL_DIR)).toBe(ACCOUNT_UUID)
  })

  it('does not hand the chat the work session while the pane writes under the personal config dir, before any request', async () => {
    const h = harness()
    await runCcrImagePipeline(run(WORK_DIR, [OLD_1, OLD_2]), h.deps)
    expect(ccrSessionForTab(PANE, 1, CLAUDE_SESSION, WORK_DIR)).toBe(WORK_CSE)
    expect(ccrSessionForTab(PANE, 1, CLAUDE_SESSION, PERSONAL_DIR)).toBeNull()
    expect(ccrAccountForTab(PANE, 1, CLAUDE_SESSION, PERSONAL_DIR)).toBeNull()
  })

  it('drops the work match kept across a restart once the pane writes under the personal config dir', async () => {
    const h = harness()
    await runCcrImagePipeline(run(WORK_DIR, [OLD_1, OLD_2]), h.deps)
    await restartCcrCacheForTests()
    await hydrateCcrSessionMappings()
    expect(ccrSessionForTab(PANE, 2, CLAUDE_SESSION, PERSONAL_DIR)).toBeNull()
    forgetSharedCcrLists()
    const after = await runCcrImagePipeline({ ...run(PERSONAL_DIR, [OLD_1, OLD_2, NEW_1]), epoch: 2 }, h.deps)
    expect(after.sessionId).toBe(PERSONAL_CSE)
  })

  it('drops a match kept by an earlier build, which recorded no config dir, when the pane’s config dir belongs to another account', async () => {
    // The phone's state on 2026-10-15: the kept match names the work account and no config dir,
    // and `~/.claude` is bound to the personal account by the other personal tabs' matches.
    setCcrMapping(PANE, WORK_CSE, 1, WORK_ACCOUNT, CLAUDE_SESSION)
    bindCcrConfigDir(PERSONAL_DIR, ACCOUNT_UUID)
    expect(ccrSessionForTab(PANE, 1, CLAUDE_SESSION, PERSONAL_DIR)).toBeNull()
    const h = harness()
    const after = await runCcrImagePipeline(run(PERSONAL_DIR, [OLD_1, OLD_2, NEW_1]), h.deps)
    expect(after.sessionId).toBe(PERSONAL_CSE)
  })

  it('keeps a match whose config dir is unchanged, with no request', async () => {
    const h = harness()
    await runCcrImagePipeline(run(WORK_DIR, [OLD_1, OLD_2]), h.deps)
    h.sent.length = 0
    const again = await runCcrImagePipeline(run(WORK_DIR, [OLD_1, OLD_2]), h.deps)
    expect(again.sessionId).toBe(WORK_CSE)
    expect(h.sent).toEqual([])
    expect(ccrSessionForTab(PANE, 1, CLAUDE_SESSION, WORK_DIR)).toBe(WORK_CSE)
  })

  it('matched afresh with both sessions holding the copied history, reads the one holding the newest message', async () => {
    const h = harness([OLD_1, OLD_2, NEW_1])
    const after = await runCcrImagePipeline(run(PERSONAL_DIR, [OLD_1, OLD_2, NEW_1]), h.deps)
    expect(after.sessionId).toBe(PERSONAL_CSE)
  })

  it('does not settle for the work session when the config dir is bound to the work account and only an older message is there', async () => {
    // A binding is a hint: the work session stops at the copy, the personal one holds what came after.
    bindCcrConfigDir(PERSONAL_DIR, WORK_ACCOUNT)
    const h = harness()
    const after = await runCcrImagePipeline(run(PERSONAL_DIR, [OLD_1, OLD_2, NEW_1]), h.deps)
    expect(after.sessionId).toBe(PERSONAL_CSE)
    expect(ccrAccountForTab(PANE, 1, CLAUDE_SESSION, PERSONAL_DIR)).toBe(ACCOUNT_UUID)
  })

  it('still matches the bound account’s session on an older message when no account holds a newer one', async () => {
    bindCcrConfigDir(WORK_DIR, WORK_ACCOUNT)
    const h = harness([])
    const after = await runCcrImagePipeline(run(WORK_DIR, [OLD_1, OLD_2, NEW_1]), h.deps)
    expect(after.sessionId).toBe(WORK_CSE)
  })

  it('keeps the match when the pane’s config dir is not known: nothing says it moved', async () => {
    const h = harness()
    await runCcrImagePipeline(run(WORK_DIR, [OLD_1, OLD_2]), h.deps)
    expect(ccrSessionForTab(PANE, 1, CLAUDE_SESSION, null)).toBe(WORK_CSE)
    expect(ccrSessionForTab(PANE, 1, CLAUDE_SESSION)).toBe(WORK_CSE)
  })

  it('keeps an earlier build’s match when its config dir is not bound to any account yet', async () => {
    setCcrMapping(PANE, WORK_CSE, 1, WORK_ACCOUNT, CLAUDE_SESSION)
    expect(ccrSessionForTab(PANE, 1, CLAUDE_SESSION, PERSONAL_DIR)).toBe(WORK_CSE)
  })
})
