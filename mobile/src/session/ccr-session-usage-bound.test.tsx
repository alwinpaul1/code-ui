import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-secure-store', () => ({ setItemAsync: vi.fn(), getItemAsync: vi.fn(async () => null), deleteItemAsync: vi.fn() }))
vi.mock('expo-crypto', () => ({ getRandomBytes: vi.fn(), digestStringAsync: vi.fn() }))
vi.mock('expo-linking', () => ({ openURL: vi.fn() }))

import { bindCcrConfigDir, resetCcrCacheForTests } from './ccr-session-cache'
import { refreshCcrUsage, resetCcrUsageForTests } from './ccr-session-usage'
import type { CcrPipelineDeps } from './ccr-session-shared'
import { applyCcrUsageToHud } from './ccr-usage-hud'
import { useCcrSessionUsage } from './use-ccr-session-usage'
import { fakeAccounts, reply, type FakeAccount } from './fixtures/ccr-session-api-2026-10-14'

// The user, 2026-10-15: "the work tab must show the work account's numbers only". Before the session
// match lands, the tab's Claude config dir (~/.claude-work) is bound to the account it was last
// matched under (codeui:ccr-config-dir-account-v1), and that account's /api/oauth/usage is the rows.
// Live shapes of the usage reply, 2026-10-15: five_hour/seven_day {utilization (percent), resets_at}.

const WORK: FakeAccount = { id: 'acct-work', label: 'Work', token: 'tok-work', organizationUuid: 'org-work' }
const PERSONAL: FakeAccount = { id: 'acct-personal', label: 'Personal', token: 'tok-personal', organizationUuid: 'org-personal' }
const WORK_DIR = '/Users/u/.claude-work'
const PERSONAL_DIR = '/Users/u/.claude'
const HOST_ROWS = [{ name: 'Session', usedPercent: 12, windowMinutes: 300, resetsAt: 9_999_999_999 }]

function depsFor(accounts: FakeAccount[]): { deps: CcrPipelineDeps; tokens: string[] } {
  const tokens: string[] = []
  const deps: CcrPipelineDeps = {
    fetch: async (url, init) => {
      if (new URL(url).pathname !== '/api/oauth/usage') {
        return reply(404, {})
      }
      tokens.push(init.headers.Authorization ?? '')
      return init.headers.Authorization === 'Bearer tok-work'
        ? reply(200, { five_hour: { utilization: 88, resets_at: '2026-10-15T14:00:00.000000+00:00' }, seven_day: { utilization: 40, resets_at: '2026-10-19T09:00:00.000000+00:00' } })
        : reply(200, { five_hour: { utilization: 3, resets_at: '2026-10-15T15:00:00.000000+00:00' }, seven_day: { utilization: 10, resets_at: '2026-10-20T09:00:00.000000+00:00' } })
    },
    accounts: fakeAccounts(accounts).source,
    keep: () => '',
    maxBytes: 1,
    log: () => {}
  }
  return { deps, tokens }
}

let renderer: ReactTestRenderer | null = null
let seen: ReturnType<typeof useCcrSessionUsage> | null = null

function Probe(props: { tabId: string; configDir: string | null }) {
  seen = useCcrSessionUsage({ enabled: true, tabId: props.tabId, agentSessionId: 'claude-session', configDir: props.configDir, epoch: 1 })
  return null
}

async function show(tabId: string, configDir: string | null) {
  await act(async () => {
    renderer = create(createElement(Probe, { tabId, configDir }))
  })
}

/** What the tab draws for its rows: today's host rows, run through the merge. */
function rowsDrawn() {
  const merged = applyCcrUsageToHud(
    { context: null, limits: HOST_ROWS, usedTokens: null },
    { reading: seen!.reading, matchedAccount: seen!.matchedAccount, hostFeedAllowed: seen!.hostFeedAllowed, beaconDecidesLimits: false }
  )
  return merged.limits.map((row) => row.usedPercent)
}

beforeEach(() => {
  resetCcrCacheForTests()
  resetCcrUsageForTests()
  bindCcrConfigDir(WORK_DIR, WORK.id)
  bindCcrConfigDir(PERSONAL_DIR, PERSONAL.id)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  seen = null
})

describe('a tab whose session is not matched yet', () => {
  it('shows the work account’s rows when its config dir is bound to the work account', async () => {
    const { deps, tokens } = depsFor([WORK, PERSONAL])
    await refreshCcrUsage('tab-work', 1, deps, 'claude-session', true, WORK_DIR)
    await show('tab-work', WORK_DIR)
    expect(rowsDrawn()).toEqual([88, 40])
    expect(tokens).toEqual(['Bearer tok-work'])
    // The session's context stays unknown until the match lands.
    expect(seen!.reading?.context).toBeNull()
    expect(seen!.reading?.sessionId).toBeNull()
  })

  it('shows the personal rows on a personal tab beside it, never the work ones', async () => {
    const { deps } = depsFor([WORK, PERSONAL])
    await refreshCcrUsage('tab-personal', 1, deps, 'claude-session', true, PERSONAL_DIR)
    await show('tab-personal', PERSONAL_DIR)
    expect(rowsDrawn()).toEqual([3, 10])
  })

  it('shows no rows, not the host’s feed, when the config dir is unbound and two accounts are signed in', async () => {
    const { deps, tokens } = depsFor([WORK, PERSONAL])
    await refreshCcrUsage('tab-new', 1, deps, 'claude-session', true, '/Users/u/.claude-other')
    await show('tab-new', '/Users/u/.claude-other')
    expect(rowsDrawn()).toEqual([])
    expect(tokens).toEqual([])
  })

  it('shows no rows before the sign-in count has been read at all', async () => {
    await show('tab-new', '/Users/u/.claude-other')
    expect(rowsDrawn()).toEqual([])
  })

  it('keeps today’s host feed when exactly one account is signed in and nothing is bound', async () => {
    const { deps } = depsFor([PERSONAL])
    await refreshCcrUsage('tab-new', 1, deps, 'claude-session', true, '/Users/u/.claude-other')
    await show('tab-new', '/Users/u/.claude-other')
    expect(rowsDrawn()).toEqual([12])
  })

  it('keeps today’s host feed when nobody is signed in', async () => {
    const { deps } = depsFor([])
    await refreshCcrUsage('tab-new', 1, deps, 'claude-session', true, null)
    await show('tab-new', null)
    expect(rowsDrawn()).toEqual([12])
  })

  it('shows no rows when the bound account has signed out and others remain', async () => {
    const { deps } = depsFor([PERSONAL, { id: 'acct-third', label: 'Third', token: 'tok-third', organizationUuid: 'org-third' }])
    await refreshCcrUsage('tab-work', 1, deps, 'claude-session', true, WORK_DIR)
    await show('tab-work', WORK_DIR)
    expect(rowsDrawn()).toEqual([])
  })
})
