/**
 * The organization the phone's Anthropic sign-in acts for, cached for the
 * session API (session/ccr-session-pipeline.ts). It belongs to the account that
 * signed in: a sign-out deletes it, and so does a new sign-in, which may be
 * another account.
 */
import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ store: new Map<string, string>() }))

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
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
  digestStringAsync: async () => 'digest'
}))
vi.mock('expo-linking', () => ({ openURL: async () => undefined }))

import { clearCredential, clearStoredOrganization, exchangeCode, readStoredOrganization, storeOrganization } from './anthropic-auth-store'

const ORG = { accountUuid: '61c5b078-0000-4000-8000-00000000a001', organizationUuid: '8f3fa7c8-0000-4000-8000-00000000b002' }

beforeEach(() => {
  fake.store.clear()
  vi.unstubAllGlobals()
})

describe('the cached organization', () => {
  it('is read back as stored, under its own key', async () => {
    await storeOrganization(ORG)
    expect([...fake.store.keys()]).toEqual(['anthropic-ccr-org-v1'])
    await expect(readStoredOrganization()).resolves.toEqual(ORG)
  })

  it('is none when nothing is stored', async () => {
    await expect(readStoredOrganization()).resolves.toBeNull()
  })

  it.each([
    ['not JSON', '{'],
    ['missing the organization', JSON.stringify({ accountUuid: 'a' })],
    ['an empty organization', JSON.stringify({ accountUuid: 'a', organizationUuid: '' })]
  ])('is none when what is stored is %s', async (_name, raw) => {
    fake.store.set('anthropic-ccr-org-v1', raw)
    await expect(readStoredOrganization()).resolves.toBeNull()
  })

  it('is deleted on sign-out', async () => {
    await storeOrganization(ORG)
    await clearCredential()
    await expect(readStoredOrganization()).resolves.toBeNull()
  })

  it('is deleted when it is cleared on its own', async () => {
    await storeOrganization(ORG)
    await clearStoredOrganization()
    await expect(readStoredOrganization()).resolves.toBeNull()
  })

  it('is deleted by a new sign-in, which may be another account', async () => {
    await storeOrganization(ORG)
    fake.store.set('anthropic-dictation-oauth-state', 'st')
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) }))
    await exchangeCode('code#st', 'verifier')
    await expect(readStoredOrganization()).resolves.toBeNull()
  })

  it('survives a failed sign-in', async () => {
    await storeOrganization(ORG)
    fake.store.set('anthropic-dictation-oauth-state', 'st')
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 400, text: async () => 'bad code' }))
    await expect(exchangeCode('code#st', 'verifier')).rejects.toThrow('Token exchange failed (400)')
    await expect(readStoredOrganization()).resolves.toEqual(ORG)
  })
})
