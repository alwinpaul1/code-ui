import { beforeEach, describe, expect, it, vi } from 'vitest'

// Review 2026-10-15: after a 401 the session link asks for its account's sign-in `fresh`, and the
// real deps ignored the flag: they read the same token again, so the retry was refused too.

const reads = vi.hoisted(() => ({ calls: [] as { only: string | undefined; refresh: boolean }[], token: 'old' }))

vi.mock('expo/fetch', () => ({ fetch: vi.fn() }))
vi.mock('./host-image-files', () => ({ keepHostImageFile: () => null }))
vi.mock('../dictation/anthropic-auth-store', () => ({ forgetAccountOrganization: vi.fn(), rememberAccountProfile: vi.fn(async () => undefined) }))
vi.mock('../dictation/anthropic-credential-reader', () => ({
  fetchAccountCredentials: async (only?: string, options?: { refresh?: boolean }) => {
    reads.calls.push({ only, refresh: options?.refresh === true })
    return [{ id: only, label: 'Work', accessToken: options?.refresh ? 'new' : reads.token, organizationUuid: 'org' }]
  }
}))

import { defaultCcrLinkDeps } from './ccr-session-default-deps'

beforeEach(() => {
  reads.calls = []
})

describe('the session link’s sign-in', () => {
  it('is refreshed when the link asks for it fresh, after a 401', async () => {
    const deps = defaultCcrLinkDeps()
    expect(await deps.auth('acct', false)).toEqual({ token: 'old', organizationUuid: 'org' })
    expect(await deps.auth('acct', true)).toEqual({ token: 'new', organizationUuid: 'org' })
    expect(reads.calls).toEqual([
      { only: 'acct', refresh: false },
      { only: 'acct', refresh: true }
    ])
  })

  it('a fresh read does not take the answer of a plain read already in flight', async () => {
    const deps = defaultCcrLinkDeps()
    const [plain, fresh] = await Promise.all([deps.auth('acct', false), deps.auth('acct', true)])
    expect(plain?.token).toBe('old')
    expect(fresh?.token).toBe('new')
  })
})
