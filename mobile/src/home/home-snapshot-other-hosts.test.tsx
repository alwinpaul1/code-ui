import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostWorktreeInfo } from '../worktree/home-worktree-info'

/**
 * Home's cached cards for every paired desktop, across a launch where the cache read is refused or
 * is still out when one desktop's live data lands. Either way the snapshot was built from live data
 * alone and saved, erasing every other desktop's cached cards (review, 2026-09-30). The REAL
 * `useMobileHomeData` and the REAL home-snapshot-cache run here over an AsyncStorage double.
 */

type WorktreeSetter = (
  updater: (previous: Record<string, HostWorktreeInfo>) => Record<string, HostWorktreeInfo>
) => void

const SNAPSHOT_KEY = 'orca:home-snapshot:v1'

const storage = vi.hoisted(() => ({
  snapshotRead: null as null | (() => Promise<string | null>),
  writes: [] as { key: string; value: string }[],
  setWorktreeInfo: null as null | ((updater: unknown) => void)
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) =>
      key === 'orca:home-snapshot:v1' && storage.snapshotRead ? storage.snapshotRead() : null
    ),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.writes.push({ key, value })
    })
  }
}))
vi.mock('expo-router', async () => {
  const react = await import('react')
  return {
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
    useFocusEffect: (effect: () => void | (() => void)) => {
      const latest = react.useRef(effect)
      latest.current = effect
      react.useEffect(() => latest.current(), [])
    }
  }
})
vi.mock('../cache/worktree-cache', () => ({
  getCachedWorktrees: () => null,
  setCachedWorktrees: vi.fn()
}))
vi.mock('../onboarding/mobile-onboarding-plan', () => ({
  loadMobileOnboardingSteps: vi.fn(async () => []),
  mobileOnboardingDestination: vi.fn()
}))
vi.mock('../transport/host-store', () => ({ loadHostCatalog: async () => [] }))
vi.mock('./use-mobile-home-host-connections', () => ({
  useMobileHomeHostConnections: (
    _hosts: unknown,
    _catalog: unknown,
    setters: { setWorktreeInfo: (updater: unknown) => void }
  ) => {
    storage.setWorktreeInfo = setters.setWorktreeInfo
    return {
      allClients: [],
      hostStates: {},
      hostAttempts: {},
      hostLastConnected: {},
      autoConnectHostIds: new Set()
    }
  }
}))
vi.mock('../worktree/home-host-worktree-fetch', () => ({ fetchHomeHostWorktreeInfo: vi.fn() }))
vi.mock('./mobile-home-host-requests', () => ({
  fetchMobileHomeAccounts: vi.fn(),
  fetchMobileHomeStats: vi.fn(),
  fetchMobileHomeTaskProviders: vi.fn()
}))
vi.mock('./refresh-account-usage', () => ({ refreshAccountUsage: vi.fn() }))
vi.mock('../components/AccountUsage', () => ({ hasRenderableUsage: () => false }))

function info(hostId: string, totalWorktrees: number): HostWorktreeInfo {
  return { hostId, totalWorktrees, activeCount: 0, lastActiveWorktree: null }
}

/** What an earlier launch saved: both desktops' cards. */
const STORED = JSON.stringify({
  worktreeInfo: { studio: info('studio', 3), laptop: info('laptop', 5) },
  accountsByHost: {},
  savedAt: 1
})

/** The snapshot write that lands after the cache's 250 ms throttle, if any. */
async function savedSnapshot(): Promise<{ worktreeInfo: Record<string, unknown> } | null> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300))
  })
  const write = storage.writes.findLast(({ key }) => key === SNAPSHOT_KEY)
  return write ? JSON.parse(write.value) : null
}

async function liveWorktrees(hostId: string, total: number): Promise<void> {
  await act(async () => {
    const setter = storage.setWorktreeInfo as WorktreeSetter
    setter((previous) => ({ ...previous, [hostId]: info(hostId, total) }))
  })
}

describe("Home's cached cards for the other desktops", () => {
  let renderer: ReactTestRenderer | null = null
  let latest: { worktreeInfo: Record<string, HostWorktreeInfo> } | null = null

  async function mount(): Promise<void> {
    // A fresh cache module per case: it holds the last snapshot in memory for the process.
    vi.resetModules()
    const { useMobileHomeData } = await import('./use-mobile-home-data')
    function Probe() {
      latest = useMobileHomeData()
      return null
    }
    await act(async () => {
      renderer = create(createElement(Probe))
    })
  }

  beforeEach(() => {
    storage.snapshotRead = null
    storage.writes = []
    storage.setWorktreeInfo = null
    latest = null
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('never saves over them after the cache read was refused', async () => {
    storage.snapshotRead = async () => {
      throw new Error('AsyncStorage is unavailable')
    }
    await mount()
    await liveWorktrees('studio', 4)
    // A snapshot of the studio alone would erase the laptop's stored cards, and nothing here knows
    // them after the read was refused: so nothing is written this launch.
    expect(await savedSnapshot()).toBeNull()
  })

  it('keeps them when one desktop answers before the cache read does', async () => {
    let release: (value: string | null) => void = () => undefined
    storage.snapshotRead = () => new Promise((resolve) => (release = resolve))
    await mount()
    await liveWorktrees('studio', 4)
    await act(async () => {
      release(STORED)
    })
    // The live count wins for the desktop that answered; the cached one stays for the other.
    expect(latest?.worktreeInfo.studio?.totalWorktrees).toBe(4)
    expect(latest?.worktreeInfo.laptop?.totalWorktrees).toBe(5)
    const saved = await savedSnapshot()
    expect(Object.keys(saved?.worktreeInfo ?? {}).sort()).toEqual(['laptop', 'studio'])
  })

  it('still saves a first snapshot on a phone that has none', async () => {
    storage.snapshotRead = async () => null
    await mount()
    await liveWorktrees('studio', 4)
    const saved = await savedSnapshot()
    expect(Object.keys(saved?.worktreeInfo ?? {})).toEqual(['studio'])
  })
})
