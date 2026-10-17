import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Each Code UI account's claude.ai web session (reported 2026-10-17: two accounts signed in under
 * Settings, and an artifact still opened on claude.ai's "Sign in to view this page"). The native
 * module (modules/orca-claude-session) is stood in for by a fake with a cookie jar; the Kotlin
 * itself is pinned by reading its source, below, for the one thing no JS test can see: that the
 * session key has no way out of it.
 */

const SECRET = 'sk-ant-sid01-NEVER-IN-JS'
const fake = vi.hoisted(() => {
  const state = {
    present: true,
    jar: { sessionKey: null as string | null, org: null as string | null },
    stored: new Map<string, { sessionKey: string; org: string }>(),
    calls: [] as string[]
  }
  const native = {
    peekClaudeSession: vi.fn(async () => ({ signedIn: state.jar.sessionKey !== null, org: state.jar.org })),
    captureClaudeSession: vi.fn(async (accountId: string, expectedOrg: string) => {
      state.calls.push(`capture:${accountId}`)
      if (state.jar.sessionKey === null || state.jar.org !== expectedOrg) {
        return { org: state.jar.org, stored: false }
      }
      state.stored.set(accountId, { sessionKey: state.jar.sessionKey, org: state.jar.org })
      return { org: state.jar.org, stored: true }
    }),
    seedClaudeSession: vi.fn(async (accountId: string) => {
      state.calls.push(`seed:${accountId}`)
      const session = state.stored.get(accountId)
      state.jar = session ? { ...session } : { sessionKey: null, org: null }
      return session !== undefined
    }),
    hasClaudeSession: vi.fn(async (accountId: string) => state.stored.has(accountId)),
    clearClaudeSession: vi.fn(async (accountId: string) => {
      state.calls.push(`clear:${accountId}`)
      if (state.stored.get(accountId)?.sessionKey === state.jar.sessionKey) {
        state.jar = { sessionKey: null, org: null }
      }
      state.stored.delete(accountId)
    }),
    clearAllClaudeSessions: vi.fn(async () => {
      state.calls.push('clear-all')
      state.stored.clear()
      state.jar = { sessionKey: null, org: null }
    }),
    clearClaudeCookies: vi.fn(async () => {
      state.calls.push('clear-cookies')
      state.jar = { sessionKey: null, org: null }
    }),
    lastClaudeSessionAccount: vi.fn(async () => null)
  }
  return { state, native }
})
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'OrcaClaudeSession' && fake.state.present ? fake.native : null)
}))

import { notifyAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'
import {
  captureClaudeSession,
  claudeSessionOtherAccountMessage,
  hasClaudeSession,
  seedClaudeSession,
  subscribeClaudeSessionChanged,
  wireClaudeSessionSignOut,
  type ClaudeSessionAccount
} from './claude-ai-session'

const PERSONAL: ClaudeSessionAccount = { id: 'acct-personal', organizationUuid: 'org-personal', label: 'Account 1' }
const WORK: ClaudeSessionAccount = { id: 'acct-work', organizationUuid: 'org-work', label: 'NexDash' }
const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve()
  }
}

beforeEach(() => {
  fake.state.present = true
  fake.state.jar = { sessionKey: null, org: null }
  fake.state.stored.clear()
  fake.state.calls.length = 0
  for (const fn of Object.values(fake.native)) {
    fn.mockClear()
  }
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('capturing a claude.ai sign-in', () => {
  it("keeps the session for the account whose organization claude.ai is on, and says it changed", async () => {
    fake.state.jar = { sessionKey: SECRET, org: 'org-work' }
    const heard = vi.fn()
    const off = subscribeClaudeSessionChanged(heard)
    expect(await captureClaudeSession(WORK, [PERSONAL, WORK])).toEqual({ kind: 'stored' })
    off()
    expect(fake.native.captureClaudeSession).toHaveBeenCalledWith('acct-work', 'org-work')
    expect(await hasClaudeSession('acct-work')).toBe(true)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('refuses a claude.ai sign-in that belongs to another account, clears the jar, and names whose it was', async () => {
    fake.state.jar = { sessionKey: SECRET, org: 'org-personal' }
    const result = await captureClaudeSession(WORK, [PERSONAL, WORK])
    expect(result).toEqual({ kind: 'other-account', label: 'Account 1' })
    expect(fake.native.captureClaudeSession).not.toHaveBeenCalled()
    expect(fake.state.calls).toEqual(['clear-cookies'])
    expect(fake.state.jar.sessionKey).toBeNull()
    expect(await hasClaudeSession('acct-work')).toBe(false)
    expect(claudeSessionOtherAccountMessage('Account 1')).toBe(
      'You signed in to claude.ai as Account 1, a different account; switch accounts there and try again.'
    )
  })

  it('refuses a sign-in for an organization no Code UI account has, and says a different account', async () => {
    fake.state.jar = { sessionKey: SECRET, org: 'org-stranger' }
    expect(await captureClaudeSession(WORK, [PERSONAL, WORK])).toEqual({ kind: 'other-account', label: null })
    expect(claudeSessionOtherAccountMessage(null)).toBe('You signed in to claude.ai as a different account; switch accounts there and try again.')
  })

  it('waits while the jar has no signed-in session, or claude.ai has not named its organization yet', async () => {
    expect(await captureClaudeSession(WORK)).toEqual({ kind: 'waiting' })
    fake.state.jar = { sessionKey: SECRET, org: null }
    expect(await captureClaudeSession(WORK)).toEqual({ kind: 'waiting' })
    expect(fake.native.captureClaudeSession).not.toHaveBeenCalled()
  })

  it("stores nothing for an account whose own organization is not known: it cannot be matched", async () => {
    fake.state.jar = { sessionKey: SECRET, org: 'org-work' }
    expect(await captureClaudeSession({ ...WORK, organizationUuid: null })).toEqual({ kind: 'unknown-org' })
    expect(fake.state.stored.size).toBe(0)
  })

  it('says it failed, not stored, where the phone has no module', async () => {
    fake.state.present = false
    expect((await captureClaudeSession(WORK)).kind).toBe('failed')
    expect(await seedClaudeSession('acct-work')).toBe('unavailable')
    expect(await hasClaudeSession('acct-work')).toBe(false)
  })

  it('says failed, not stored, when the module throws', async () => {
    fake.native.peekClaudeSession.mockRejectedValueOnce(new Error('CookieManager unavailable'))
    expect(await captureClaudeSession(WORK)).toEqual({ kind: 'failed', reason: 'CookieManager unavailable' })
  })
})

describe('seeding the viewer', () => {
  it('replaces the jar with each account in turn, never a mix of the two', async () => {
    fake.state.stored.set('acct-personal', { sessionKey: 'one', org: 'org-personal' })
    fake.state.stored.set('acct-work', { sessionKey: 'two', org: 'org-work' })
    expect(await seedClaudeSession('acct-personal')).toBe('seeded')
    expect(fake.state.jar.org).toBe('org-personal')
    expect(await seedClaudeSession('acct-work')).toBe('seeded')
    expect(fake.state.jar).toEqual({ sessionKey: 'two', org: 'org-work' })
  })

  it('answers none for an account with nothing stored', async () => {
    expect(await seedClaudeSession('acct-work')).toBe('none')
  })

  it('answers unavailable, so the page still loads, when the module throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fake.native.seedClaudeSession.mockRejectedValueOnce(new Error('boom'))
    expect(await seedClaudeSession('acct-work')).toBe('unavailable')
  })
})

describe('sign-out forgets the claude.ai session', () => {
  it("forgets the signed-out account's session and leaves the other's", async () => {
    wireClaudeSessionSignOut()
    fake.state.stored.set('acct-personal', { sessionKey: 'one', org: 'org-personal' })
    fake.state.stored.set('acct-work', { sessionKey: 'two', org: 'org-work' })
    fake.state.jar = { sessionKey: 'two', org: 'org-work' }
    notifyAnthropicAccountsChanged({ signedOut: 'acct-work' })
    await settle()
    expect(fake.state.calls).toContain('clear:acct-work')
    expect(await hasClaudeSession('acct-work')).toBe(false)
    expect(await hasClaudeSession('acct-personal')).toBe(true)
    // The jar held the signed-out account's session, so it is gone from there too.
    expect(fake.state.jar.sessionKey).toBeNull()
  })

  it('forgets every session on Sign out of all accounts, and those of entries merged away', async () => {
    wireClaudeSessionSignOut()
    notifyAnthropicAccountsChanged({ signedOut: 'all' })
    notifyAnthropicAccountsChanged({ removed: ['pending-1'] })
    await settle()
    expect(fake.state.calls).toEqual(['clear-all', 'clear:pending-1'])
  })

  it('installs its listener once, however many screens wire it', async () => {
    wireClaudeSessionSignOut()
    wireClaudeSessionSignOut()
    notifyAnthropicAccountsChanged({ signedOut: 'acct-work' })
    await settle()
    expect(fake.state.calls.filter((call) => call === 'clear:acct-work')).toHaveLength(1)
  })
})

describe('never hands the claude.ai session to JavaScript', () => {
  it('no answer of the JS side carries the session key, even after a capture and a seed', async () => {
    fake.state.jar = { sessionKey: SECRET, org: 'org-work' }
    const answers = [
      await captureClaudeSession(WORK, [PERSONAL, WORK]),
      await seedClaudeSession('acct-work'),
      await hasClaudeSession('acct-work')
    ]
    expect(JSON.stringify(answers)).not.toContain(SECRET)
  })

  // The module's source, with its comments taken out so prose cannot satisfy or trip the checks.
  const kotlin = readFileSync(
    fileURLToPath(
      new URL('../../modules/orca-claude-session/android/src/main/java/expo/modules/orcaclaudesession/OrcaClaudeSessionModule.kt', import.meta.url)
    ),
    'utf8'
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it('answers JavaScript with only the organization and booleans', () => {
    const keys = [...kotlin.matchAll(/"(\w+)" to /g)].map((match) => match[1])
    expect(new Set(keys)).toEqual(new Set(['signedIn', 'org', 'stored']))
    // The jar's key and the stored session's key are never the value of an answer.
    expect(kotlin).not.toMatch(/to\s+\w*\.sessionKey\b/)
    expect(kotlin).not.toMatch(/AsyncFunction\("[^"]+"\)[^\n]*\{[^\n]*sessionKey\s*$/m)
  })

  it('logs only an exception class, never a cookie or a session', () => {
    const logs = [...kotlin.matchAll(/Log\.\w\(([^\n]*)\)/g)].map((match) => match[1]!)
    expect(logs.length).toBeGreaterThan(0)
    for (const line of logs) {
      // The only thing a log line interpolates is the exception's class name.
      const interpolated = [...line.matchAll(/\$\{([^}]*)\}|\$(\w+)/g)].map((match) => match[1] ?? match[2])
      expect(interpolated).toEqual(['error.javaClass.simpleName'])
    }
  })

  it('stores the session only under the Keystore key, as ciphertext', () => {
    expect(kotlin).toContain('AES/GCM/NoPadding')
    expect(kotlin).toContain('"AndroidKeyStore"')
    // The only putString of an entry is the sealed value.
    const puts = [...kotlin.matchAll(/putString\((.*?)\)\.(?:apply|commit)\(\)/g)].map((match) => match[1]!)
    expect(puts.sort()).toEqual(['LAST_KEY, accountId', 'entryKey(accountId), value'])
    expect(kotlin).toMatch(/val value = Base64\.encodeToString\(cipher\.iv[^\n]*Base64\.encodeToString\(sealed/)
  })
})
