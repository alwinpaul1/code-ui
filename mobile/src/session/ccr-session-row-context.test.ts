import { describe, expect, it } from 'vitest'
import { listCcrSessions } from './ccr-session-api'
import { resetCcrCacheForTests, setCcrMapping } from './ccr-session-cache'
import { noteModel } from './ccr-session-model-refresh'
import type { CcrPipelineDeps } from './ccr-session-shared'
import { ccrUsageForTab, refreshCcrUsage, resetCcrUsageForTests } from './ccr-session-usage'
import { fakeAccounts, fakeFetch, reply, sessionRow, sessionsReply } from './fixtures/ccr-session-api-2026-10-14'

// Claude Code 2.1.300 writes `external_metadata.context_usage {used_tokens, max_tokens}` each turn (its
// `ct()`), and the Claude app's ring reads it (afu.java, iju.java:29). Live 2026-10-15 the result
// event's `modelUsage` is `{}`, so the row is the only place the session states its window.

const SESSION = 'cse_01QXwwwwwwwwwwwwwwwwwwww'
const WORK = { id: 'acct-work', label: 'Work', token: 'tok-work', organizationUuid: 'org-work' }

const rowWith = (contextUsage: unknown) =>
  fakeFetch([() => reply(200, sessionsReply([sessionRow(SESSION, { external_metadata: { model: 'claude-opus-5-5', context_usage: contextUsage } })]))]).fetch

const read = async (contextUsage: unknown) =>
  (await listCcrSessions(rowWith(contextUsage), { token: 't', organizationUuid: 'o' }, { cursor: null, limit: 50 })).sessions[0]!

describe('the session row’s own context statement', () => {
  it('is read from external_metadata.context_usage as used and max tokens', async () => {
    expect((await read({ used_tokens: 80_003, max_tokens: 1_000_000 })).contextUsage).toEqual({ usedTokens: 80_003, maxTokens: 1_000_000 })
  })

  it.each([
    ['absent', undefined],
    ['a window of zero', { used_tokens: 5, max_tokens: 0 }],
    ['negative used tokens', { used_tokens: -1, max_tokens: 200_000 }],
    ['strings', { used_tokens: '5', max_tokens: '200000' }]
  ])('is nothing when %s, as the Claude app rejects it', async (_name, stated) => {
    expect((await read(stated)).contextUsage).toBeNull()
  })

  it('reaches the ring through the model re-read: noteModel keeps it, the usage read uses it', async () => {
    resetCcrCacheForTests()
    resetCcrUsageForTests()
    setCcrMapping('tab-work', SESSION, 1, WORK.id)
    noteModel('tab-work', 1, await read({ used_tokens: 150_000, max_tokens: 200_000 }), () => {})
    const fetch: CcrPipelineDeps['fetch'] = async () => reply(200, {})
    await refreshCcrUsage('tab-work', 1, { fetch, accounts: fakeAccounts([WORK]).source, keep: () => '', maxBytes: 1, log: () => {} }, null, false)
    expect(ccrUsageForTab('tab-work', 1, SESSION, WORK.id)?.context).toEqual({ usedTokens: 150_000, windowTokens: 200_000 })
  })
})
