/** Review 2026-10-17: `unowned` must mean every signed-in account was fully searched. A tab whose
 *  session is signed in but ranks past CCR_MAX_CANDIDATES was told "isn't signed in on the phone". */
import { beforeEach, describe, expect, it } from 'vitest'
import type { CcrFetch } from './ccr-session-api'
import { resetCcrModelForTests } from './ccr-session-model'
import { resetCcrPipelineForTests } from './ccr-session-pipeline'
import { assistantEvent, eventsReply, fakeAccounts, reply, sessionRow, sessionsReply, systemEvent, type FakeAccount } from './fixtures/ccr-session-api-2026-10-14'
import { lookUpDictationSessionAccount } from './dictation-session-account'

const PERSONAL: FakeAccount = { id: 'acct-personal', label: 'Account 1', token: 'tok-personal', organizationUuid: 'org-personal' }
const WORK: FakeAccount = { id: 'acct-work', label: 'NexDash', token: 'tok-work', organizationUuid: 'org-work' }
const WORK_SESSION = 'cse_01QXwwwwwwwwwwwwwwwwwwww'
const TAB_MESSAGES = ['7a1e0c55-0000-4000-8000-0000000000a1', '7a1e0c55-0000-4000-8000-0000000000a2']

beforeEach(() => {
  resetCcrPipelineForTests()
  resetCcrModelForTests()
})

describe('a session that is signed in is never called unsigned', () => {
  it('does not say "not signed in" when the owning account\'s session was past the candidate cap', async () => {
    const fetch: CcrFetch = async (url, init) => {
      const parsed = new URL(url)
      const token = init.headers.Authorization?.replace('Bearer ', '')
      if (parsed.pathname === '/v1/code/sessions') {
        if (token === WORK.token) {
          return reply(200, sessionsReply([sessionRow(WORK_SESSION, { last_event_at: '2026-10-01T10:00:00Z' })]))
        }
        const rows = Array.from({ length: 40 }, (_, i) => sessionRow(`cse_01QXp${String(i).padStart(2, '0')}pppppppppppppppp`))
        return reply(200, sessionsReply(rows))
      }
      const m = /^\/v1\/code\/sessions\/([^/]+)\/events$/.exec(parsed.pathname)
      if (m) {
        const holds = decodeURIComponent(m[1]!) === WORK_SESSION
        return reply(200, eventsReply(holds ? [assistantEvent(TAB_MESSAGES[1]!, 'toolu_01', '/tmp/a.png')] : [systemEvent('other')]))
      }
      return reply(404, {})
    }
    const deps = { fetch, accounts: fakeAccounts([PERSONAL, WORK]).source, keep: (_k: string, uri: string) => uri, maxBytes: 1, log: () => {} }
    const result = await lookUpDictationSessionAccount(
      { tabId: 'tab-x', epoch: 1, agentSessionId: 's1', configDir: null },
      { messageIds: TAB_MESSAGES, newestMessageAt: null },
      () => Promise.resolve(deps)
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).not.toMatch(/isn't signed in on the phone/)
  })
})
