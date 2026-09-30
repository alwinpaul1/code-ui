import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskProvider } from '../tasks/mobile-task-providers'

/**
 * Home's primary task sources while the connected desktop's provider read has not answered. They
 * defaulted to ['github'], so the Tasks card claimed GitHub, with a tappable icon, for a user
 * whose visible providers were GitLab and Linear only (review, 2026-09-30). The REAL
 * `useMobileHomeData` runs here, with one desktop connected and the provider read held.
 */

type ProvidersSetter = (
  updater: (previous: Record<string, TaskProvider[]>) => Record<string, TaskProvider[]>
) => void

const home = vi.hoisted(() => ({ setProviders: null as null | ProvidersSetter }))

// Focus runs once, as a screen that opened; the catalog read hangs off it.
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
vi.mock('../transport/host-store', () => ({
  loadHostCatalog: async () => [
    {
      id: 'mac',
      credentialStatus: 'ready',
      profile: {
        id: 'mac',
        name: 'mac',
        endpoint: 'ws://x',
        deviceToken: 't',
        publicKeyB64: 'k',
        lastConnected: 1
      }
    }
  ]
}))
vi.mock('./use-mobile-home-host-connections', () => ({
  useMobileHomeHostConnections: (
    _hosts: unknown,
    _catalog: unknown,
    setters: { setTaskProviders: ProvidersSetter }
  ) => {
    home.setProviders = setters.setTaskProviders
    return {
      allClients: [],
      hostStates: { mac: 'connected' },
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

import { useMobileHomeData } from './use-mobile-home-data'

describe('the task sources Home shows for a connected desktop', () => {
  let renderer: ReactTestRenderer | null = null
  let latest: ReturnType<typeof useMobileHomeData> | null = null

  function Probe() {
    latest = useMobileHomeData()
    return null
  }

  beforeEach(() => {
    latest = null
    home.setProviders = null
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('claims no provider before the provider read answers', async () => {
    await act(async () => {
      renderer = create(createElement(Probe))
    })
    expect(latest?.primaryHost?.id).toBe('mac')
    expect(latest?.primaryTaskProviders).toBeUndefined()
  })

  it('shows what the read found once it answers', async () => {
    await act(async () => {
      renderer = create(createElement(Probe))
    })
    await act(async () => {
      home.setProviders?.((previous) => ({ ...previous, mac: ['gitlab', 'linear'] }))
    })
    expect(latest?.primaryTaskProviders).toEqual(['gitlab', 'linear'])
  })
})
