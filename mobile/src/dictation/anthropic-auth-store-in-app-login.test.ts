/**
 * The in-app sign-in (AnthropicSignInScreen.tsx, 2026-10-17): the authorize page the browser sign-in
 * used to open, loaded in a WebView, whose redirect to the code page is taken instead of copied
 * by hand. One sign-in then also leaves the account's claude.ai session in the WebView's jar.
 * Against the real module, with only the native stores faked.
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

import { codeFromCallbackUrl, exchangeCode, prepareLogin } from './anthropic-auth-store'

const CALLBACK = 'https://platform.claude.com/oauth/code/callback'

beforeEach(() => {
  fake.store.clear()
  fake.opened.length = 0
  vi.unstubAllGlobals()
})

describe('the in-app sign-in', () => {
  it('loads the authorize page in the app, never opening the browser', async () => {
    const page = new URL((await prepareLogin()).url)
    expect(fake.opened).toEqual([])
    expect(`${page.origin}${page.pathname}`).toBe('https://claude.com/cai/oauth/authorize')
    expect(page.searchParams.get('redirect_uri')).toBe(CALLBACK)
  })

  it("takes the code page's address as the pasted code, and the exchange accepts it as this sign-in's", async () => {
    const { url, codeVerifier } = await prepareLogin()
    const state = new URL(url).searchParams.get('state')!
    const pasted = codeFromCallbackUrl(`${CALLBACK}?code=abc123&state=${state}`)
    expect(pasted).toBe(`abc123#${state}`)
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), text: async () => '' }))
    await expect(exchangeCode(pasted!, codeVerifier)).resolves.toMatchObject({ accessToken: 'at' })
  })

  it('takes nothing from any other page, or from the code page without a code', () => {
    expect(codeFromCallbackUrl('https://claude.ai/oauth/authorize?code=abc&state=s')).toBeNull()
    expect(codeFromCallbackUrl('https://platform.claude.com.evil.example/oauth/code/callback?code=abc&state=s')).toBeNull()
    expect(codeFromCallbackUrl(`${CALLBACK}?state=s`)).toBeNull()
    expect(codeFromCallbackUrl(`${CALLBACK}?code=abc`)).toBeNull()
    expect(codeFromCallbackUrl('not a url')).toBeNull()
  })
})
