/**
 * The phone signs in to each Anthropic account the user runs on the desktop (the default profile
 * and a work profile are different accounts in different organizations). These pin the list: a
 * sign-in from before it existed is kept, the same account twice is one entry, a sign-out takes
 * one account and leaves the others, and one account's refresh failing signs nobody out.
 */
import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ store: new Map<string, string>(), writes: 0, failWrites: false, failNextReadOf: null as string | null }))

vi.mock('expo-secure-store', () => ({
  setItemAsync: async (key: string, value: string) => {
    if (fake.failWrites) {
      throw new Error('keystore locked')
    }
    fake.writes += 1
    fake.store.set(key, value)
  },
  getItemAsync: async (key: string) => {
    if (fake.failNextReadOf === key) {
      fake.failNextReadOf = null
      throw new Error('keystore busy')
    }
    return fake.store.get(key) ?? null
  },
  deleteItemAsync: async (key: string) => {
    fake.store.delete(key)
  }
}))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
  digestStringAsync: async () => 'digest'
}))
vi.mock('expo-linking', () => ({ openURL: async () => undefined }))

import { fetchAccountCredentials, fetchAnthropicCredential } from './anthropic-credential-reader'
import { subscribeAnthropicAccountsChanged } from './anthropic-accounts-events'
import {
  clearCredential,
  exchangeCode,
  forgetAccountOrganization,
  isLoggedIn,
  listAccounts,
  readCredential,
  rememberAccountProfile,
  removeAccount
} from './anthropic-auth-store'

const DEFAULT_ACCOUNT = '61c5b078-0000-4000-8000-00000000a001'
const DEFAULT_ORG = '8f3fa7c8-0000-4000-8000-00000000b002'
const WORK_ACCOUNT = '77d1e0aa-0000-4000-8000-00000000a003'
const WORK_ORG = '2b9c44d1-0000-4000-8000-00000000b004'

const FRESH = () => Date.now() + 3_600_000

/** A sign-in as the single-account builds kept it (key `anthropic-dictation-oauth-v2`). */
const LEGACY_CREDENTIAL = { accessToken: 'legacy-access', refreshToken: 'legacy-refresh', expiresAt: 0 }

/** Signs in through the real paste-the-code exchange; the profile endpoint answers as `profile` says. */
async function signIn(token: string, profile: { account: string; org: string; name: string } | 'unreadable'): Promise<void> {
  fake.store.set('anthropic-dictation-oauth-state', 'st')
  vi.stubGlobal('fetch', async (url: string) =>
    url.endsWith('/api/oauth/profile')
      ? profile === 'unreadable'
        ? { ok: false, status: 500, json: async () => ({}), text: async () => '' }
        : { ok: true, status: 200, json: async () => ({ account: { uuid: profile.account }, organization: { uuid: profile.org, name: profile.name } }) }
      : { ok: true, status: 200, json: async () => ({ access_token: token, refresh_token: `${token}-refresh`, expires_in: 3600 }) }
  )
  await exchangeCode('code#st', 'verifier')
}

beforeEach(() => {
  fake.store.clear()
  fake.writes = 0
  fake.failWrites = false
  fake.failNextReadOf = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('a sign-in made before the phone held several accounts', () => {
  it('stays signed in as the first account, without signing in again', async () => {
    fake.store.set('anthropic-dictation-oauth-v2', JSON.stringify(LEGACY_CREDENTIAL))
    fake.store.set('anthropic-ccr-org-v1', JSON.stringify({ accountUuid: DEFAULT_ACCOUNT, organizationUuid: DEFAULT_ORG }))

    const accounts = await listAccounts()

    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ id: DEFAULT_ACCOUNT, organizationUuid: DEFAULT_ORG, credential: LEGACY_CREDENTIAL })
    expect(await readCredential()).toEqual(LEGACY_CREDENTIAL)
    expect(await isLoggedIn()).toBe(true)
    // Moved, not copied: the old keys are gone once the new list holds it.
    expect(fake.store.has('anthropic-dictation-oauth-v2')).toBe(false)
    expect(fake.store.has('anthropic-ccr-org-v1')).toBe(false)
  })

  it('is migrated once: a second read finds the same single account', async () => {
    fake.store.set('anthropic-dictation-oauth-v2', JSON.stringify(LEGACY_CREDENTIAL))
    await listAccounts()
    const writes = fake.writes
    expect(await listAccounts()).toHaveLength(1)
    expect(fake.writes).toBe(writes)
  })

  it('keeps the old sign-in when the new list cannot be written, and tries again next read', async () => {
    fake.store.set('anthropic-dictation-oauth-v2', JSON.stringify(LEGACY_CREDENTIAL))
    fake.failWrites = true
    await expect(listAccounts()).rejects.toThrow('keystore locked')
    expect(fake.store.has('anthropic-dictation-oauth-v2')).toBe(true)
    fake.failWrites = false
    expect(await readCredential()).toEqual(LEGACY_CREDENTIAL)
  })

  it('signs the next account in beside it, which stays the primary', async () => {
    fake.store.set('anthropic-dictation-oauth-v2', JSON.stringify(LEGACY_CREDENTIAL))
    fake.store.set('anthropic-ccr-org-v1', JSON.stringify({ accountUuid: DEFAULT_ACCOUNT, organizationUuid: DEFAULT_ORG }))
    await signIn('work-access', { account: WORK_ACCOUNT, org: WORK_ORG, name: 'NexDash' })
    expect((await listAccounts()).map((account) => account.id)).toEqual([DEFAULT_ACCOUNT, WORK_ACCOUNT])
    expect((await readCredential())?.accessToken).toBe('legacy-access')
  })

  it('still counts a three-scope token as signed out', async () => {
    fake.store.set('anthropic-dictation-oauth', JSON.stringify({ accessToken: 'three-scope', refreshToken: 'r', expiresAt: FRESH() }))
    expect(await listAccounts()).toEqual([])
    expect(await isLoggedIn()).toBe(false)
  })
})

describe('signing in', () => {
  it('lists nobody when nobody is signed in', async () => {
    expect(await listAccounts()).toEqual([])
    expect(await readCredential()).toBeNull()
    expect(await fetchAccountCredentials()).toEqual([])
  })

  it('names the account by its organization', async () => {
    await signIn('a1', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    expect(await listAccounts()).toMatchObject([{ id: DEFAULT_ACCOUNT, organizationUuid: DEFAULT_ORG, organizationName: 'Personal' }])
  })

  it('makes the same account signed in twice one entry, with the newer token, in the same place', async () => {
    await signIn('first', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    await signIn('work', { account: WORK_ACCOUNT, org: WORK_ORG, name: 'NexDash' })
    await signIn('second', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })

    const accounts = await listAccounts()
    expect(accounts.map((account) => account.id)).toEqual([DEFAULT_ACCOUNT, WORK_ACCOUNT])
    expect(accounts[0]!.credential.accessToken).toBe('second')
  })

  it('keeps a sign-in whose profile could not be read, and says so', async () => {
    await signIn('mystery', 'unreadable')
    const accounts = await listAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ accountUuid: null, organizationUuid: null })
    expect(accounts[0]!.id).toMatch(/^pending-/)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('the profile could not be read'))
  })

  it('merges an unidentified sign-in into the account it turns out to be', async () => {
    await signIn('known', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    await signIn('mystery', 'unreadable')
    const pending = (await listAccounts())[1]!
    await rememberAccountProfile(pending.id, { accountUuid: DEFAULT_ACCOUNT, organizationUuid: DEFAULT_ORG, organizationName: 'Personal' })

    const accounts = await listAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ id: DEFAULT_ACCOUNT })
    expect(accounts[0]!.credential.accessToken).toBe('mystery')
  })

  it('asks for the organization again after one is forgotten', async () => {
    await signIn('a1', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    await forgetAccountOrganization(DEFAULT_ACCOUNT)
    expect((await listAccounts())[0]).toMatchObject({ id: DEFAULT_ACCOUNT, organizationUuid: null })
  })
})

describe('signing out', () => {
  it('signs out one account and keeps the other signed in', async () => {
    await signIn('a1', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    await signIn('w1', { account: WORK_ACCOUNT, org: WORK_ORG, name: 'NexDash' })
    await removeAccount(DEFAULT_ACCOUNT)
    expect((await listAccounts()).map((account) => account.id)).toEqual([WORK_ACCOUNT])
  })

  it('hands dictation to the next account when the primary signs out', async () => {
    await signIn('a1', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    await signIn('w1', { account: WORK_ACCOUNT, org: WORK_ORG, name: 'NexDash' })
    await removeAccount(DEFAULT_ACCOUNT)
    expect((await readCredential())?.accessToken).toBe('w1')
  })

  it('signing out the only account leaves nobody signed in', async () => {
    await signIn('a1', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    await removeAccount(DEFAULT_ACCOUNT)
    expect(await listAccounts()).toEqual([])
    expect(await isLoggedIn()).toBe(false)
  })

  it('signing out an account that is not listed changes nothing', async () => {
    await signIn('a1', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    await removeAccount('not-an-account')
    expect(await listAccounts()).toHaveLength(1)
  })

  it('clearCredential signs every account out', async () => {
    await signIn('a1', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    await signIn('w1', { account: WORK_ACCOUNT, org: WORK_ORG, name: 'NexDash' })
    await clearCredential()
    expect(await listAccounts()).toEqual([])
  })
})

describe('refreshing each account', () => {
  async function twoAccountsDue(): Promise<void> {
    await signIn('a-old', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    await signIn('w-old', { account: WORK_ACCOUNT, org: WORK_ORG, name: 'NexDash' })
    // Both tokens are past their expiry, so reading them refreshes them.
    const accounts = (await listAccounts()).map((account) => ({ ...account, credential: { ...account.credential, expiresAt: 0 } }))
    fake.store.set('anthropic-accounts-v1', JSON.stringify({ accounts }))
  }

  const refreshEndpoint = (answers: Record<string, number>) =>
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const refresh = JSON.parse(init.body).refresh_token as string
      const status = answers[refresh] ?? 200
      return {
        ok: status === 200,
        status,
        json: async () => ({ access_token: refresh.replace('-old-refresh', '-new'), refresh_token: `${refresh}-rotated`, expires_in: 3600 })
      }
    })

  it("keeps the work account signed in when the default account's refresh is refused", async () => {
    await twoAccountsDue()
    refreshEndpoint({ 'a-old-refresh': 400 })

    const read = await fetchAccountCredentials()

    expect(read.map((account) => [account.id, account.accessToken])).toEqual([
      [DEFAULT_ACCOUNT, null],
      [WORK_ACCOUNT, 'w-new']
    ])
    expect(read[0]!.error).toContain('could not be refreshed')
    // Nobody was signed out: the refused account is still listed, and the other holds its new token.
    const stored = await listAccounts()
    expect(stored.map((account) => account.id)).toEqual([DEFAULT_ACCOUNT, WORK_ACCOUNT])
    expect(stored[1]!.credential).toMatchObject({ accessToken: 'w-new', refreshToken: 'w-old-refresh-rotated' })
  })

  it('writes both new tokens when the two accounts refresh at the same moment', async () => {
    await twoAccountsDue()
    refreshEndpoint({})
    await fetchAccountCredentials()
    expect((await listAccounts()).map((account) => account.credential.accessToken)).toEqual(['a-new', 'w-new'])
  })

  it('refreshes the primary for dictation without touching the others', async () => {
    await twoAccountsDue()
    refreshEndpoint({})
    expect((await fetchAnthropicCredential())?.accessToken).toBe('a-new')
    expect((await listAccounts())[1]!.credential.accessToken).toBe('w-old')
  })

  it('does not refresh an account whose token has life left', async () => {
    await signIn('a1', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect((await fetchAccountCredentials())[0]!.accessToken).toBe('a1')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reading one account for the model pill refreshes that account and no other', async () => {
    await twoAccountsDue()
    refreshEndpoint({})
    const read = await fetchAccountCredentials(WORK_ACCOUNT)
    expect(read.map((account) => [account.id, account.accessToken])).toEqual([[WORK_ACCOUNT, 'w-new']])
    expect((await listAccounts())[0]!.credential.accessToken).toBe('a-old')
  })

  it('spends a refresh token once when dictation and the sessions path refresh the same account at once', async () => {
    await twoAccountsDue()
    const spent: string[] = []
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const refresh = JSON.parse(init.body).refresh_token as string
      spent.push(refresh)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { ok: true, status: 200, json: async () => ({ access_token: refresh.replace('-old-refresh', '-new'), refresh_token: `${refresh}-rotated`, expires_in: 3600 }) }
    })

    const [dictation, sessions] = await Promise.all([fetchAnthropicCredential(), fetchAccountCredentials()])

    expect(spent.filter((token) => token === 'a-old-refresh')).toHaveLength(1)
    expect(dictation?.accessToken).toBe('a-new')
    expect(sessions[0]!.accessToken).toBe('a-new')
  })
})

/** Two identified accounts, stored as a sign-in writes them. */
async function twoAccountsStored(): Promise<string> {
  await signIn('a1', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
  await signIn('w1', { account: WORK_ACCOUNT, org: WORK_ORG, name: 'NexDash' })
  return fake.store.get('anthropic-accounts-v1')!
}

describe('a saved list that cannot be read is never written over (review of 2026-10-14)', () => {
  it('keeps both accounts when one keystore read fails just before a 401 forgets an organization', async () => {
    const before = await twoAccountsStored()
    fake.failNextReadOf = 'anthropic-accounts-v1'

    await forgetAccountOrganization(WORK_ACCOUNT).catch(() => undefined)

    expect(fake.store.get('anthropic-accounts-v1')).toBe(before)
    expect((await listAccounts()).map((account) => account.id)).toEqual([DEFAULT_ACCOUNT, WORK_ACCOUNT])
  })

  it('refuses the write and says why, instead of resolving as if it had stored it', async () => {
    await twoAccountsStored()
    fake.failNextReadOf = 'anthropic-accounts-v1'
    await expect(removeAccount(WORK_ACCOUNT)).rejects.toThrow('keystore busy')
  })

  it('keeps both accounts when a sign-in lands on a read that failed', async () => {
    const before = await twoAccountsStored()
    fake.store.set('anthropic-dictation-oauth-state', 'st')
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/api/oauth/profile')
        ? { ok: false, status: 500, json: async () => ({}), text: async () => '' }
        : { ok: true, status: 200, json: async () => ({ access_token: 'third', refresh_token: 'third-refresh', expires_in: 3600 }) }
    )
    fake.failNextReadOf = 'anthropic-accounts-v1'
    await exchangeCode('code#st', 'verifier').catch(() => undefined)
    expect(fake.store.get('anthropic-accounts-v1')).toBe(before)
  })

  it.each([
    ['cut-off JSON', '{"accounts":[{"id":"'],
    ['a list that is not one', '{"accounts":"nope"}']
  ])('does not write over a stored list that reads as %s', async (_name, corrupt) => {
    fake.store.set('anthropic-accounts-v1', corrupt)
    await forgetAccountOrganization(WORK_ACCOUNT).catch(() => undefined)
    await removeAccount(DEFAULT_ACCOUNT).catch(() => undefined)
    await signIn('w2', { account: WORK_ACCOUNT, org: WORK_ORG, name: 'NexDash' }).catch(() => undefined)
    expect(fake.store.get('anthropic-accounts-v1')).toBe(corrupt)
    await expect(listAccounts()).rejects.toThrow('could not be read')
  })

  it('lets a sign-in land after the unreadable sign-ins are cleared', async () => {
    fake.store.set('anthropic-accounts-v1', '{"accounts":[{"id":"')
    await clearCredential()
    await signIn('w2', { account: WORK_ACCOUNT, org: WORK_ORG, name: 'NexDash' })
    expect((await listAccounts()).map((account) => account.id)).toEqual([WORK_ACCOUNT])
  })
})

describe('one account signed in twice, the first time unidentified (review of 2026-10-14)', () => {
  it('keeps the newer sign-in’s credential when the unidentified one turns out to be an account already listed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    await signIn('old-tok', 'unreadable')
    const pendingId = (await listAccounts())[0]!.id
    vi.setSystemTime(2_000_000)
    await signIn('new-tok', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })

    await rememberAccountProfile(pendingId, { accountUuid: DEFAULT_ACCOUNT, organizationUuid: DEFAULT_ORG, organizationName: 'Personal' })

    const accounts = await listAccounts()
    expect(accounts.map((account) => account.id)).toEqual([DEFAULT_ACCOUNT])
    expect(accounts[0]!.credential.accessToken).toBe('new-tok')
  })
})

describe('an account whose sign-in died (review of 2026-10-14)', () => {
  it('a sign-in again replaces a migrated primary whose refresh token was refused, and dictation uses the new one', async () => {
    fake.store.set('anthropic-dictation-oauth-v2', JSON.stringify({ accessToken: 'dead', refreshToken: 'dead-refresh', expiresAt: 0 }))
    await listAccounts()
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }))
    expect(await fetchAnthropicCredential()).toBeNull()

    await signIn('fresh', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })

    expect((await readCredential())?.accessToken).toBe('fresh')
    expect((await listAccounts()).map((account) => account.id)).toEqual([DEFAULT_ACCOUNT])
  })

  it('dictation skips an expired primary that has no refresh token, and uses the next account', async () => {
    fake.store.set('anthropic-dictation-oauth-v2', JSON.stringify({ accessToken: 'dead', refreshToken: '', expiresAt: 0 }))
    await listAccounts()
    expect(await readCredential()).toBeNull()
    expect(await isLoggedIn()).toBe(false)

    await signIn('fresh', { account: WORK_ACCOUNT, org: WORK_ORG, name: 'NexDash' })

    expect((await readCredential())?.accessToken).toBe('fresh')
    expect(await isLoggedIn()).toBe(true)
  })

  it('does not count a refresh that failed on the network as a dead sign-in', async () => {
    fake.store.set('anthropic-dictation-oauth-v2', JSON.stringify({ accessToken: 'alive', refreshToken: 'alive-refresh', expiresAt: 0 }))
    await listAccounts()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Network request failed')
    })
    expect(await fetchAnthropicCredential()).toBeNull()
    expect((await readCredential())?.accessToken).toBe('alive')
  })

  // Review of 2026-10-14: any 400/401/403 marked the sign-in dead for good, so one 403 from a
  // WAF challenge or a captive portal signed the only account out. Only OAuth's own answer for a
  // spent or revoked refresh token, `invalid_grant` (RFC 6749 5.2), says the sign-in is dead.
  it('keeps the sign-in when one refresh is refused by something other than an invalid_grant', async () => {
    fake.store.set('anthropic-dictation-oauth-v2', JSON.stringify({ accessToken: 'alive', refreshToken: 'alive-refresh', expiresAt: 0 }))
    await listAccounts()
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 403,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
      text: async () => '<html>Just a moment...</html>'
    }))
    expect(await fetchAnthropicCredential()).toBeNull()

    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'renewed', refresh_token: 'r2', expires_in: 3600 }) }))
    expect((await fetchAnthropicCredential())?.accessToken).toBe('renewed')
  })
})

describe('a sign-in whose profile read hangs (review of 2026-10-14)', () => {
  it('finishes the sign-in, unidentified, instead of leaving the spinner busy forever', async () => {
    vi.useFakeTimers()
    fake.store.set('anthropic-dictation-oauth-state', 'st')
    vi.stubGlobal('fetch', (url: string) =>
      url.endsWith('/api/oauth/profile')
        ? new Promise(() => undefined)
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ access_token: 'slow', refresh_token: 'slow-refresh', expires_in: 3600 }) })
    )
    let settled = false
    const done = exchangeCode('code#st', 'verifier').then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(30_000)

    expect(settled).toBe(true)
    await done
    vi.useRealTimers()
    const accounts = await listAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]!.id).toMatch(/^pending-/)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('timed out'))
  })
})

// A tab that failed to match before the work account signed in waited out its back-off (up to ten
// minutes) for no reason: nothing told the sessions path the accounts had changed (2026-10-15).
describe('telling the sessions path the accounts changed', () => {
  function heard(): { count: () => number; stop: () => void } {
    let count = 0
    const stop = subscribeAnthropicAccountsChanged(() => {
      count += 1
    })
    return { count: () => count, stop }
  }

  it('says so on a sign-in, a sign-out and a sign-out of everyone', async () => {
    const ear = heard()
    await signIn('a1', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    expect(ear.count()).toBe(1)
    await signIn('w1', { account: WORK_ACCOUNT, org: WORK_ORG, name: 'NexDash' })
    expect(ear.count()).toBe(2)
    await removeAccount(DEFAULT_ACCOUNT)
    expect(ear.count()).toBe(3)
    await clearCredential()
    expect(ear.count()).toBe(4)
    ear.stop()
  })

  it('says so when a sign-in turns out to be an account already listed, and the two become one', async () => {
    await signIn('known', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })
    await signIn('mystery', 'unreadable')
    const pending = (await listAccounts())[1]!
    const ear = heard()
    await rememberAccountProfile(pending.id, { accountUuid: DEFAULT_ACCOUNT, organizationUuid: DEFAULT_ORG, organizationName: 'Personal' })
    expect(ear.count()).toBe(1)
    ear.stop()
  })

  it('says nothing when the sessions path only names an account or forgets its organization', async () => {
    await signIn('mystery', 'unreadable')
    const pending = (await listAccounts())[0]!
    const ear = heard()
    await rememberAccountProfile(pending.id, { accountUuid: WORK_ACCOUNT, organizationUuid: WORK_ORG, organizationName: 'NexDash' })
    await forgetAccountOrganization(WORK_ACCOUNT)
    expect(ear.count()).toBe(0)
    ear.stop()
  })

  it('says nothing when a sign-in could not be written', async () => {
    const ear = heard()
    fake.failWrites = true
    await expect(signIn('a1', { account: DEFAULT_ACCOUNT, org: DEFAULT_ORG, name: 'Personal' })).rejects.toThrow()
    expect(ear.count()).toBe(0)
    ear.stop()
  })
})
