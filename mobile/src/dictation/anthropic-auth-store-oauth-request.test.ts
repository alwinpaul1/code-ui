/**
 * Signing in to Anthropic from Voice settings. Reported 2026-10-14 on 0.9.137: tapping "Sign in to
 * Anthropic" opened claude.ai on "Invalid OAuth request — Missing state parameter", so no code was
 * ever shown to paste back.
 *
 * Verified against Claude Code 2.1.296's own manual (paste-the-code) login, read out of its binary:
 * the authorize URL carries `code=true` and a random `state`; the callback page shows
 * `<code>#<state>`, which the CLI splits on `#`; the token exchange is JSON and sends that `state`
 * back. These tests pin each of those against the real module with only the native stores faked.
 */
import { createHash, randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  store: new Map<string, string>(),
  opened: [] as string[]
}))

vi.mock('expo-secure-store', () => ({
  setItemAsync: async (key: string, value: string) => {
    fake.store.set(key, value)
  },
  getItemAsync: async (key: string) => fake.store.get(key) ?? null,
  deleteItemAsync: async (key: string) => {
    fake.store.delete(key)
  }
}))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
  digestStringAsync: async (_alg: string, data: string) =>
    createHash('sha256').update(data).digest('base64')
}))
vi.mock('expo-linking', () => ({
  openURL: async (url: string) => {
    fake.opened.push(url)
  }
}))

import {
  exchangeCode,
  getSavedVerifier,
  readCredential,
  refreshAccessToken,
  startLogin
} from './anthropic-auth-store'

type Posted = { url: string; headers: Record<string, string>; body: string }

function stubTokenEndpoint(status = 200): Posted[] {
  const posted: Posted[] = []
  vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; body: string }) => {
    posted.push({ url, headers: init.headers, body: init.body })
    return {
      ok: status === 200,
      status,
      json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
      text: async () => 'refused'
    }
  })
  return posted
}

async function openedLogin(): Promise<URL> {
  await startLogin()
  return new URL(fake.opened.at(-1)!)
}

beforeEach(() => {
  fake.store.clear()
  fake.opened.length = 0
  vi.unstubAllGlobals()
})

describe('the sign-in page Voice settings opens', () => {
  it('carries a state, so claude.ai does not refuse it as "Missing state parameter"', async () => {
    const url = await openedLogin()
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{43}$/)
  })

  it('asks for the paste-the-code page, as Claude Code does', async () => {
    const url = await openedLogin()
    expect(url.origin + url.pathname).toBe('https://claude.com/cai/oauth/authorize')
    expect(url.searchParams.get('code')).toBe('true')
    expect(url.searchParams.get('redirect_uri')).toBe('https://platform.claude.com/oauth/code/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('draws a fresh state for every sign-in', async () => {
    const first = (await openedLogin()).searchParams.get('state')
    const second = (await openedLogin()).searchParams.get('state')
    expect(first).not.toBe(second)
  })
})

describe('pasting the code the callback page shows', () => {
  it('exchanges the code part and sends the state back, as JSON', async () => {
    const state = (await openedLogin()).searchParams.get('state')!
    const posted = stubTokenEndpoint()
    await exchangeCode(`the-code#${state}`, (await getSavedVerifier())!)

    expect(posted).toHaveLength(1)
    expect(posted[0]!.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(posted[0]!.body)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      state,
      redirect_uri: 'https://platform.claude.com/oauth/code/callback'
    })
    expect(await readCredential()).toMatchObject({ accessToken: 'at', refreshToken: 'rt' })
  })

  it('refuses a code copied without its #state, before calling the server', async () => {
    await openedLogin()
    const posted = stubTokenEndpoint()
    await expect(exchangeCode('the-code', (await getSavedVerifier())!)).rejects.toThrow(
      'Invalid code. Make sure the full code was copied'
    )
    expect(posted).toEqual([])
  })

  it('refuses a code from a different sign-in, before calling the server', async () => {
    await openedLogin()
    const posted = stubTokenEndpoint()
    await expect(exchangeCode('the-code#someone-elses-state', (await getSavedVerifier())!)).rejects.toThrow(
      'This code is from a different sign-in. Tap Sign in again.'
    )
    expect(posted).toEqual([])
    expect(await readCredential()).toBeNull()
  })

  it('says what the server answered when the exchange fails', async () => {
    const state = (await openedLogin()).searchParams.get('state')!
    stubTokenEndpoint(400)
    await expect(exchangeCode(`the-code#${state}`, (await getSavedVerifier())!)).rejects.toThrow(
      'Token exchange failed (400): refused'
    )
    expect(await readCredential()).toBeNull()
  })
})

describe('refreshing the token', () => {
  it('posts JSON with the scopes, as Claude Code does', async () => {
    const posted = stubTokenEndpoint()
    await refreshAccessToken({ accessToken: 'old', refreshToken: 'rt-old', expiresAt: 0 })
    expect(posted[0]!.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(posted[0]!.body)).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'rt-old',
      scope: 'user:inference user:profile user:sessions:claude_code'
    })
  })
})
