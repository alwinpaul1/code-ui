import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reported 2026-09-29: a phone that already had a paired desktop drew "Connect your desktop" for
 * a moment on every launch, like a splash screen. The home screen read `hostCatalog.length === 0`
 * while the catalog was still being fetched from storage and the Keychain. Here the REAL
 * `useMobileHomeData` runs against a `loadHostCatalog` the test controls, including a genuinely
 * rejected read, and the body the screen would draw is derived through `homeBodyKind`.
 */

const focus = vi.hoisted(() => ({ run: null as null | (() => void | (() => void)) }))
const catalog = vi.hoisted(() => ({ load: vi.fn() }))

vi.mock('expo-router', async () => {
  const react = await import('react')
  return {
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
    useFocusEffect: (effect: () => void | (() => void)) => {
      react.useEffect(effect, [effect])
    }
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null) }
}))
vi.mock('../cache/home-snapshot-cache', () => ({
  loadHomeSnapshot: vi.fn(async () => null),
  saveHomeSnapshot: vi.fn()
}))
vi.mock('../cache/worktree-cache', () => ({
  getCachedWorktrees: () => null,
  setCachedWorktrees: vi.fn()
}))
vi.mock('../onboarding/mobile-onboarding-plan', () => ({
  loadMobileOnboardingSteps: vi.fn(async () => []),
  mobileOnboardingDestination: vi.fn()
}))
vi.mock('../transport/host-store', () => ({ loadHostCatalog: catalog.load }))
vi.mock('./use-mobile-home-host-connections', () => ({
  useMobileHomeHostConnections: () => ({
    allClients: [],
    hostStates: {},
    hostAttempts: {},
    hostLastConnected: {},
    autoConnectHostIds: new Set()
  })
}))
vi.mock('../worktree/home-host-worktree-fetch', () => ({ fetchHomeHostWorktreeInfo: vi.fn() }))
vi.mock('./mobile-home-host-requests', () => ({
  fetchMobileHomeAccounts: vi.fn(),
  fetchMobileHomeStats: vi.fn(),
  fetchMobileHomeTaskProviders: vi.fn()
}))
vi.mock('./refresh-account-usage', () => ({ refreshAccountUsage: vi.fn() }))
vi.mock('../components/AccountUsage', () => ({ hasRenderableUsage: () => false }))

import { homeBodyKind } from './home-body-kind'
import { useMobileHomeData } from './use-mobile-home-data'

function entry(id: string) {
  return {
    id,
    credentialStatus: 'ok',
    profile: { id, name: id, endpoint: 'ws://x', deviceToken: 't', publicKeyB64: 'k' }
  }
}

describe('home body on launch, for a phone that already has a desktop', () => {
  let renderer: ReactTestRenderer | null = null
  let kinds: string[] = []
  let loadedFlags: unknown[] = []

  function Probe() {
    const data = useMobileHomeData()
    loadedFlags.push(data.hostCatalogLoaded)
    kinds.push(homeBodyKind(data.hostCatalogLoaded, data.hostCatalog.length))
    return null
  }

  beforeEach(() => {
    kinds = []
    loadedFlags = []
    focus.run = null
    catalog.load.mockReset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  async function mount(): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Probe))
    })
  }

  it('never draws the pairing screen while the paired list is still being read', async () => {
    let release: (value: unknown[]) => void = () => {}
    catalog.load.mockReturnValue(new Promise((resolve) => (release = resolve)))
    await mount()
    expect(kinds.length).toBeGreaterThan(0)
    expect(kinds).not.toContain('pair')
    // The list is unknown, not empty: the flag must say so, not be absent.
    expect(loadedFlags.every((flag) => flag === false)).toBe(true)
    await act(async () => release([entry('mac')]))
    expect(kinds.at(-1)).toBe('hosts')
    expect(kinds).not.toContain('pair')
  })

  it('goes straight from loading to the host list for several paired desktops', async () => {
    catalog.load.mockResolvedValue([entry('a'), entry('b'), entry('c')])
    await mount()
    expect(kinds).not.toContain('pair')
    expect(kinds.at(-1)).toBe('hosts')
  })

  it('still shows the pairing screen, promptly, to a phone with no desktop at all', async () => {
    catalog.load.mockResolvedValue([])
    await mount()
    expect(kinds[0]).toBe('loading')
    expect(kinds.at(-1)).toBe('pair')
  })

  it('falls back to the pairing screen, and logs why, when the stored read rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    catalog.load.mockRejectedValue(new Error('keychain unavailable'))
    await mount()
    expect(kinds.at(-1)).toBe('pair')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[home] host catalog failed to load'),
      expect.any(Error)
    )
  })
})
