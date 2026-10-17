/**
 * The user, 2026-10-17: "for dictation use the account or profile that the session exactly belongs
 * to", and, told dictation would stop when the phone cannot tell which account: "it must exactly
 * tell". So a take in a Claude chat whose account is not matched yet asks Anthropic which signed-in
 * account holds the session (the same match the pictures and the model pill make), waits a few
 * seconds for the answer, and dictates with that account. It refuses only when Anthropic's answer is
 * that none of them holds it, or when the question could not be answered, and then says which.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CcrFetch } from './ccr-session-api'
import { resetCcrModelForTests } from './ccr-session-model'
import { ccrAccountForTab, setCcrMapping } from './ccr-session-cache'
import { resetCcrPipelineForTests, type CcrPipelineDeps } from './ccr-session-pipeline'
import { assistantEvent, eventsReply, fakeAccounts, reply, sessionRow, sessionsReply, systemEvent, type FakeAccount } from './fixtures/ccr-session-api-2026-10-14'
import { DICTATION_ACCOUNT_LOOKUP_MS, lookUpDictationSessionAccount } from './dictation-session-account'
import { SIGN_IN_TO_DICTATE } from '../dictation/dictation-account-lookup'

const PERSONAL: FakeAccount = { id: 'acct-personal', label: 'Account 1', token: 'tok-personal', organizationUuid: 'org-personal' }
const WORK: FakeAccount = { id: 'acct-work', label: 'NexDash', token: 'tok-work', organizationUuid: 'org-work' }
const PERSONAL_SESSION = 'cse_01QXpppppppppppppppppppp'
const WORK_SESSION = 'cse_01QXwwwwwwwwwwwwwwwwwwww'
const TAB_MESSAGES = ['7a1e0c55-0000-4000-8000-0000000000a1', '7a1e0c55-0000-4000-8000-0000000000a2']
const scope = { tabId: 'tab-work', epoch: 1, agentSessionId: 'claude-sess-1', configDir: '/Users/a/.claude-work' }

type Answer = (url: URL) => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>>
/** Each account lists only its own Remote Control session; the work one holds the tab's messages. */
function deps(accounts: FakeAccount[], options: { list?: Answer; workHoldsTab?: boolean; personalEndless?: boolean } = {}): { deps: CcrPipelineDeps; lines: string[] } {
  const lines: string[] = []
  const fetch: CcrFetch = async (url, init) => {
    const parsed = new URL(url)
    const token = init.headers.Authorization?.replace('Bearer ', '')
    if (parsed.pathname === '/v1/code/sessions') {
      if (options.list) {
        return options.list(parsed)
      }
      return reply(200, sessionsReply([sessionRow(token === WORK.token ? WORK_SESSION : PERSONAL_SESSION)]))
    }
    const events = /^\/v1\/code\/sessions\/([^/]+)\/events$/.exec(parsed.pathname)
    if (events) {
      const holds = decodeURIComponent(events[1]!) === WORK_SESSION && options.workHoldsTab !== false
      if (options.personalEndless && decodeURIComponent(events[1]!) === PERSONAL_SESSION) {
        // A long session: every page read while matching has another behind it.
        const page = Number(parsed.searchParams.get('cursor') ?? '0') + 1
        return reply(200, eventsReply([systemEvent(`deep-${page}`)], String(page)))
      }
      return reply(200, eventsReply(holds ? [assistantEvent(TAB_MESSAGES[1]!, 'toolu_01', '/tmp/a.png'), assistantEvent(TAB_MESSAGES[0]!, 'toolu_02', '/tmp/b.png')] : [systemEvent('other-1')]))
    }
    return reply(404, {})
  }
  return { deps: { fetch, accounts: fakeAccounts(accounts).source, keep: (_key, uri) => uri, maxBytes: 1, log: (line) => lines.push(line) }, lines }
}

const lookUp = (d: CcrPipelineDeps, messageIds: readonly string[] = TAB_MESSAGES) => lookUpDictationSessionAccount(scope, { messageIds, newestMessageAt: null }, () => Promise.resolve(d))

beforeEach(() => {
  resetCcrPipelineForTests()
  resetCcrModelForTests()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("a take finds its session's own account before the microphone opens", () => {
  it('asks Anthropic which signed-in account holds the session, and names that one', async () => {
    const h = deps([PERSONAL, WORK])
    await expect(lookUp(h.deps)).resolves.toEqual({ ok: true, accountId: WORK.id })
    // The match is the pipeline's own, kept for the tab: the pictures and the pill use it too.
    expect(ccrAccountForTab(scope.tabId, scope.epoch, scope.agentSessionId, scope.configDir)).toBe(WORK.id)
  })

  it('uses a match already made for the tab without asking Anthropic again', async () => {
    setCcrMapping(scope.tabId, WORK_SESSION, scope.epoch, WORK.id, scope.agentSessionId, scope.configDir)
    const load = vi.fn(() => Promise.resolve(deps([PERSONAL, WORK]).deps))
    await expect(lookUpDictationSessionAccount(scope, { messageIds: TAB_MESSAGES, newestMessageAt: null }, load)).resolves.toEqual({ ok: true, accountId: WORK.id })
    expect(load).not.toHaveBeenCalled()
  })

  // "it must exactly tell": one account signed in is not proof the session is its own.
  it('with one account signed in, dictates with it only once Anthropic says the session is its own', async () => {
    const h = deps([WORK])
    await expect(lookUp(h.deps)).resolves.toEqual({ ok: true, accountId: WORK.id })
    expect(ccrAccountForTab(scope.tabId, scope.epoch, scope.agentSessionId, scope.configDir)).toBe(WORK.id)
  })

  it("with one account signed in that does not hold the session, says the session is another account's", async () => {
    const result = await lookUp(deps([WORK], { workHoldsTab: false }).deps)
    expect(!result.ok && result.reason).toMatch(/^This session belongs to an Anthropic account that isn't signed in on the phone: none of the 1 signed in holds it/)
  })

  it('does not call the session unowned when a compared session was not read back to its start', async () => {
    const result = await lookUp(deps([PERSONAL, WORK], { workHoldsTab: false, personalEndless: true }).deps)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/^Can't tell which Anthropic account this session belongs to/)
  })

  it('says to sign in when no account is signed in on the phone', async () => {
    await expect(lookUp(deps([]).deps)).resolves.toEqual({ ok: false, reason: SIGN_IN_TO_DICTATE })
  })

  it("says the session belongs to an account not signed in on the phone when Anthropic's answer is that none of them holds it", async () => {
    const result = await lookUp(deps([PERSONAL, WORK], { workHoldsTab: false }).deps)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(
      /^This session belongs to an Anthropic account that isn't signed in on the phone: none of the 2 signed in holds it \(none of 2 Remote Control sessions shares a message with this tab.*\)\. Sign in to that account in Settings, Anthropic accounts, to dictate here\.$/
    )
  })

  it('says so too when none of the accounts has a Remote Control session at all', async () => {
    const result = await lookUp(deps([PERSONAL, WORK], { list: () => reply(200, sessionsReply([])) }).deps)
    expect(!result.ok && result.reason).toMatch(/^This session belongs to an Anthropic account that isn't signed in on the phone: none of the 2 signed in holds it \(no Remote Control session on these 2 accounts/)
  })

  it('refuses with the real reason, never another account, when Anthropic cannot be asked', async () => {
    const result = await lookUp(deps([PERSONAL, WORK], { list: () => Promise.reject(new TypeError('Network request failed')) }).deps)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/^Can't tell which Anthropic account this session belongs to, so dictation won't use another one: .*network error/)
    expect(!result.ok && result.reason).not.toMatch(/isn't signed in on the phone/)
  })

  it('does not call the session unowned when one account could not be asked', async () => {
    const h = deps([PERSONAL, WORK], { list: () => reply(200, sessionsReply([])) })
    const broken = { ...h.deps, accounts: fakeAccounts([PERSONAL, { ...WORK, token: null, error: 'the sign-in expired' }]).source }
    const result = await lookUp(broken)
    expect(!result.ok && result.reason).toMatch(/^Can't tell which Anthropic account this session belongs to/)
    expect(!result.ok && result.reason).toMatch(/the sign-in expired/)
  })

  it('does not call the session unowned when an account had more sessions than the pages read', async () => {
    const list: Answer = (url) => {
      const page = Number(url.searchParams.get('cursor') ?? '0') + 1
      return reply(200, sessionsReply([sessionRow(`cse_01QXlist${String(page).padStart(2, '0')}qqqqqqqqqqqqq`)], String(page)))
    }
    const result = await lookUp(deps([PERSONAL, WORK], { list }).deps)
    expect(!result.ok && result.reason).toMatch(/^Can't tell which Anthropic account this session belongs to/)
  })

  it('refuses with the reason when the tab has no transcript messages to compare yet', async () => {
    const result = await lookUp(deps([PERSONAL, WORK]).deps, [])
    expect(!result.ok && result.reason).toMatch(/^Can't tell which Anthropic account this session belongs to, so dictation won't use another one: the tab has no transcript messages to compare yet/)
  })

  it('stops waiting after a few seconds and says Anthropic did not answer', async () => {
    vi.useFakeTimers()
    const pending = lookUp(deps([PERSONAL, WORK], { list: () => new Promise(() => {}) }).deps)
    await vi.advanceTimersByTimeAsync(DICTATION_ACCOUNT_LOOKUP_MS)
    await expect(pending).resolves.toEqual({
      ok: false,
      reason: `Can't tell which Anthropic account this session belongs to: Anthropic didn't answer within ${DICTATION_ACCOUNT_LOOKUP_MS / 1000} s. Try again in a moment.`
    })
  })

  it("refuses with the reason when the phone's sign-ins cannot be read", async () => {
    const result = await lookUpDictationSessionAccount(scope, { messageIds: TAB_MESSAGES, newestMessageAt: null }, () => Promise.reject(new Error('SecureStore unavailable')))
    expect(result).toEqual({ ok: false, reason: "Can't read the phone's Anthropic sign-ins to find this session's account: SecureStore unavailable" })
  })
})
