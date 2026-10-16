import { afterEach, describe, expect, it, vi } from 'vitest'
import { claudeArtifactListFor, readClaudeArtifactAccounts, refreshClaudeArtifactList, setClaudeArtifactListDepsForTests, CLAUDE_ARTIFACT_LIST_FRESH_MS } from './claude-artifact-list-store'
import type { CcrFetch } from './ccr-session-api'
import type { CcrPipelineDeps } from './ccr-session-shared'
import { PUBLISHED_UUID } from './fixtures/claude-artifact-tool-2.1.301'

const LIST = { frames: [{ slug: PUBLISHED_UUID, title: 'Code UI Artifact Check', rel: 'mine', updatedAt: '2026-10-16T12:09:22Z' }] }

function pipeline(fetchImpl: CcrFetch, token: string | null = 'tok'): CcrPipelineDeps {
  return {
    fetch: fetchImpl,
    accounts: {
      list: async () => (token ? [{ id: 'acct', label: 'a', accessToken: token, organizationUuid: 'org', error: null }] : []),
      rememberProfile: async () => null,
      forgetOrganization: async () => undefined
    },
    keep: () => '',
    maxBytes: 0
  } as unknown as CcrPipelineDeps
}

afterEach(() => setClaudeArtifactListDepsForTests(null))

describe("an account's artifact list on the phone", () => {
  it('holds the rows a read returned', async () => {
    const fetchImpl = vi.fn<CcrFetch>(async () => ({ ok: true, status: 200, json: async () => LIST }))
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl), now: () => 1_000 })
    await refreshClaudeArtifactList('acct')
    expect(claudeArtifactListFor('acct')).toMatchObject({ loading: false, error: null, loadedAt: 1_000 })
    expect(claudeArtifactListFor('acct').items.map((item) => item.title)).toEqual(['Code UI Artifact Check'])
  })

  it('does not read again while the last read is fresh, unless forced', async () => {
    let now = 1_000
    const fetchImpl = vi.fn<CcrFetch>(async () => ({ ok: true, status: 200, json: async () => LIST }))
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl), now: () => now })
    await refreshClaudeArtifactList('acct')
    await refreshClaudeArtifactList('acct')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await refreshClaudeArtifactList('acct', { force: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    now += CLAUDE_ARTIFACT_LIST_FRESH_MS
    await refreshClaudeArtifactList('acct')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('shares one read between two screens asking at once', async () => {
    const fetchImpl = vi.fn<CcrFetch>(async () => ({ ok: true, status: 200, json: async () => LIST }))
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl) })
    await Promise.all([refreshClaudeArtifactList('acct', { force: true }), refreshClaudeArtifactList('acct', { force: true })])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('keeps the rows it had and says why when a later read fails', async () => {
    let fail = false
    const fetchImpl = vi.fn<CcrFetch>(async () => (fail ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => LIST }))
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await refreshClaudeArtifactList('acct')
    fail = true
    await refreshClaudeArtifactList('acct', { force: true })
    expect(claudeArtifactListFor('acct').items).toHaveLength(1)
    expect(claudeArtifactListFor('acct')).toMatchObject({ loading: false, error: 'artifacts: http (HTTP 503)' })
    expect(warn).toHaveBeenCalledWith('[artifacts] the account artifact list could not be read', { reason: 'artifacts: http (HTTP 503)' })
    warn.mockRestore()
  })

  it('reports a signed-out account instead of an empty list', async () => {
    const fetchImpl = vi.fn<CcrFetch>()
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl, null) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await refreshClaudeArtifactList('acct')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(claudeArtifactListFor('acct').error).not.toBeNull()
    expect(claudeArtifactListFor('acct').loadedAt).toBeNull()
    warn.mockRestore()
  })

  it('names the signed-in accounts for the gallery’s picker, primary first, and none when nobody is signed in', async () => {
    const fetchImpl = vi.fn<CcrFetch>()
    const two = pipeline(fetchImpl)
    two.accounts.list = async () => [
      { id: 'personal', label: 'Personal', accessToken: 'a', organizationUuid: 'o1' },
      { id: 'work', label: 'Acme', accessToken: null, organizationUuid: 'o2', error: 'expired' }
    ]
    setClaudeArtifactListDepsForTests({ load: async () => two })
    await expect(readClaudeArtifactAccounts()).resolves.toEqual([
      { id: 'personal', label: 'Personal' },
      { id: 'work', label: 'Acme' }
    ])
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(fetchImpl, null) })
    await expect(readClaudeArtifactAccounts()).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('holds nothing for no account', () => {
    expect(claudeArtifactListFor(null)).toEqual({ items: [], loadedAt: null, loading: false, error: null })
  })
})
