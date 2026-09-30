import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

// AccountUsage draws with react-native; only its decoder is reached here.
vi.mock('../components/AccountUsage', () => ({ decodeAccountsSnapshot: (value: unknown) => value }))

import { fetchMobileHomeAccounts, fetchMobileHomeStats } from './mobile-home-host-requests'

/**
 * Home's counts and accounts cards, when their read fails. Both are decorative, so a failed read
 * keeps what the card already showed, and that part is right. But the failure left nothing behind:
 * a refusal returned without a word and a dropped link went to `.catch(() => {})`, so a card stuck
 * on old figures could not be told apart from a desktop with nothing new (sweep of the task-source
 * fix, review round 2, 2026-09-30).
 */

function clientAnswering(method: string, reply: () => Promise<unknown>): RpcClient {
  return {
    sendRequest: vi.fn(async (sent: string) => {
      if (sent !== method) {
        throw new Error(`no reply scripted for ${sent}`)
      }
      return reply()
    })
  } as unknown as RpcClient
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function warnedLines(): string[] {
  return vi
    .mocked(console.warn)
    .mock.calls.filter((call) => String(call[0]).startsWith('[home]'))
    .map((call) => JSON.stringify(call))
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("Home's decorative cards when their read fails", () => {
  it('says which read the desktop refused, and its code, and keeps the counts it showed', async () => {
    const setStats = vi.fn()
    const refused = clientAnswering('stats.summary', async () => ({
      id: 'r',
      ok: false,
      error: { code: 'internal_error', message: 'stats store locked' }
    }))
    fetchMobileHomeStats(refused, 'mac', setStats, () => false)
    await settle()
    expect(setStats).not.toHaveBeenCalled()
    const lines = warnedLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('stats.summary')
    expect(lines[0]).toContain('internal_error')
    expect(lines[0]).toContain('mac')
  })

  it('says why the counts read failed when the link drops under it', async () => {
    const setStats = vi.fn()
    const dropped = clientAnswering('stats.summary', async () => {
      throw new Error('Connection interrupted')
    })
    fetchMobileHomeStats(dropped, 'mac', setStats, () => false)
    await settle()
    expect(setStats).not.toHaveBeenCalled()
    const lines = warnedLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('stats.summary')
    expect(lines[0]).toContain('Connection interrupted')
  })

  it('says which read the desktop refused, and its code, and keeps the accounts it showed', async () => {
    const setAccounts = vi.fn()
    const refused = clientAnswering('accounts.list', async () => ({
      id: 'r',
      ok: false,
      error: { code: 'unavailable', message: 'keychain locked' }
    }))
    fetchMobileHomeAccounts(refused, 'mac', setAccounts, () => false)
    await settle()
    expect(setAccounts).not.toHaveBeenCalled()
    const lines = warnedLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('accounts.list')
    expect(lines[0]).toContain('unavailable')
  })

  it('says why the accounts read failed when the link drops under it', async () => {
    const setAccounts = vi.fn()
    const dropped = clientAnswering('accounts.list', async () => {
      throw new Error('Request timed out: accounts.list')
    })
    fetchMobileHomeAccounts(dropped, 'mac', setAccounts, () => false)
    await settle()
    expect(setAccounts).not.toHaveBeenCalled()
    const lines = warnedLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('accounts.list')
    expect(lines[0]).toContain('Request timed out')
  })

  it('stays quiet when the reads answer', async () => {
    const setStats = vi.fn()
    fetchMobileHomeStats(
      clientAnswering('stats.summary', async () => ({ id: 'r', ok: true, result: {} })),
      'mac',
      setStats,
      () => false
    )
    await settle()
    expect(warnedLines()).toEqual([])
  })
})
