import { afterEach, describe, expect, it } from 'vitest'
import type { CcrFetch, CcrFetchResponse } from './ccr-session-api'
import type { CcrAccountsSource } from './ccr-session-shared'
import { ccrSessionFactsForTab, noteCcrSessionFacts, resetCcrSessionFactsForTests } from './ccr-session-facts'
import { parseCcrSessionRow } from './ccr-session-row'
import {
  CCR_SESSION_WRITES,
  buildCcrMarkReadRequest,
  buildCcrRenameRequest,
  markCcrSessionRead,
  renameCcrSession
} from './ccr-session-writes'

// The Claude app renames a Code session with `PUT v1/code/sessions/{id}` and an
// UpdateSessionParams body holding only `title` (ssv.java:183 `ozl.m(3, …)`, method 3 = PUT in
// kre.z; drv.M0 builds `new ww00(title, null, removeTags = null)`, uw00.java), and marks it read
// with `POST v1/code/sessions/{cse_id}/mark_read` and `{event_id}` (drv.java:3099, bqk/zpk). The
// phone has never sent either with its per-account token, so both sit behind CCR_SESSION_WRITES.
const SESSION = 'session_01QXaaaaaaaaaaaaaaaaaaaa'
const CSE = 'cse_01QXaaaaaaaaaaaaaaaaaaaa'
const TOKEN = 'test-oauth-token-not-a-real-credential'
const ORG = '8f3fa7c8-0000-4000-8000-00000000b002'
const ACCOUNT = '61c5b078-0000-4000-8000-00000000a001'

type Sent = { url: string; method: string; headers: Record<string, string>; body?: string }

function harness(answer: () => CcrFetchResponse | Promise<CcrFetchResponse>, account: { token: string | null; org: string | null } | null = { token: TOKEN, org: ORG }) {
  const sent: Sent[] = []
  const fetch: CcrFetch = async (url, init) => {
    sent.push({ url, method: init.method, headers: { ...init.headers }, body: init.body })
    return answer()
  }
  const accounts: CcrAccountsSource = {
    list: async (only) => (account && (only === undefined || only === ACCOUNT) ? [{ id: ACCOUNT, label: 'Example org', accessToken: account.token, organizationUuid: account.org, error: account.token ? undefined : 'expired' }] : []),
    rememberProfile: async (id) => id,
    forgetOrganization: async () => undefined
  }
  return { sent, deps: { fetch, accounts, log: (_line: string) => undefined } }
}
const ok = (): CcrFetchResponse => ({ ok: true, status: 200, json: async () => ({}) })
const status = (code: number) => (): CcrFetchResponse => ({ ok: false, status: code, json: async () => ({}), text: async () => '' })
const target = { kind: 'target' as const, sessionId: SESSION, accountId: ACCOUNT }

afterEach(() => resetCcrSessionFactsForTests())

describe('the session writes switch', () => {
  it('is off until probe P16 shows the token is accepted', () => {
    expect(CCR_SESSION_WRITES).toBe(false)
  })
})

describe('renaming a Claude session on Anthropic, as the app does', () => {
  it('sends PUT with only the title, to the cse_ id, with the app headers', () => {
    expect(buildCcrRenameRequest(SESSION, '  Fix the login bug  ')).toEqual({ method: 'PUT', path: `/v1/code/sessions/${CSE}`, body: { title: 'Fix the login bug' } })
  })

  it('puts the new title on the session and shows it in the header at once', async () => {
    const row = parseCcrSessionRow({ id: CSE, title: 'Old name' })!
    noteCcrSessionFacts('tab-1', 1, row)
    const { sent, deps } = harness(ok)
    expect(await renameCcrSession(deps, target, 'Fix the login bug')).toBe('renamed')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ url: `https://api.anthropic.com/v1/code/sessions/${CSE}`, method: 'PUT', body: '{"title":"Fix the login bug"}' })
    expect(sent[0]!.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'X-Organization-Uuid': ORG, 'Anthropic-Beta': 'ccr-byoc-2025-07-29', 'Content-Type': 'application/json' })
    expect(ccrSessionFactsForTab('tab-1', CSE)?.title).toBe('Fix the login bug')
  })

  it('refuses an empty name without sending anything', async () => {
    const { sent, deps } = harness(ok)
    expect(await renameCcrSession(deps, target, '   ')).toBe('refused')
    expect(sent).toHaveLength(0)
  })

  it('refuses a tab with no target of its own (another profile’s copy, unmatched)', async () => {
    const { sent, deps } = harness(ok)
    expect(await renameCcrSession(deps, { kind: 'refused', reason: 'other-account' }, 'x')).toBe('refused')
    expect(sent).toHaveLength(0)
  })

  it('fails, and keeps the old title, when the server refuses the token', async () => {
    noteCcrSessionFacts('tab-1', 1, parseCcrSessionRow({ id: CSE, title: 'Old name' })!)
    const lines: string[] = []
    const { deps } = harness(status(403))
    expect(await renameCcrSession({ ...deps, log: (line) => lines.push(line) }, target, 'New')).toBe('failed')
    expect(ccrSessionFactsForTab('tab-1', CSE)?.title).toBe('Old name')
    // The one line it leaves names the stage and the status, never the token.
    expect(lines.join('\n')).toMatch(/rename.*403/)
    expect(lines.join('\n')).not.toContain(TOKEN)
  })

  it('fails when the network drops, and when the account is signed out', async () => {
    const dropped = harness(() => Promise.reject(new Error('offline')))
    expect(await renameCcrSession(dropped.deps, target, 'New')).toBe('failed')
    const signedOut = harness(ok, null)
    expect(await renameCcrSession(signedOut.deps, target, 'New')).toBe('failed')
    expect(signedOut.sent).toHaveLength(0)
    const noToken = harness(ok, { token: null, org: ORG })
    expect(await renameCcrSession(noToken.deps, target, 'New')).toBe('failed')
    expect(noToken.sent).toHaveLength(0)
  })
})

describe('marking a Claude session read on Anthropic, as the app does on open', () => {
  it('posts {event_id} to mark_read under the cse_ id, and {} with no event known', () => {
    expect(buildCcrMarkReadRequest(SESSION, 'evt_9')).toEqual({ method: 'POST', path: `/v1/code/sessions/${CSE}/mark_read`, body: { event_id: 'evt_9' } })
    expect(buildCcrMarkReadRequest(SESSION, null)).toEqual({ method: 'POST', path: `/v1/code/sessions/${CSE}/mark_read`, body: {} })
  })

  it('sends it once with the account’s sign-in and reports a refusal without throwing', async () => {
    const good = harness(ok)
    expect(await markCcrSessionRead(good.deps, target, 'evt_9')).toBe(true)
    expect(good.sent[0]).toMatchObject({ method: 'POST', url: `https://api.anthropic.com/v1/code/sessions/${CSE}/mark_read`, body: '{"event_id":"evt_9"}' })
    const refused = harness(status(404))
    expect(await markCcrSessionRead(refused.deps, target, null)).toBe(false)
  })
})
