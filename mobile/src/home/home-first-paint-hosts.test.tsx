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

const focus = vi.hoisted(() => ({
  refocus: null as null | (() => void),
  router: { replace: vi.fn(), push: vi.fn() }
}))
const catalog = vi.hoisted(() => ({ load: vi.fn() }))

vi.mock('expo-router', async () => {
  const react = await import('react')
  return {
    useRouter: () => focus.router,
    useFocusEffect: (effect: () => void | (() => void)) => {
      const latest = react.useRef(effect)
      latest.current = effect
      react.useEffect(() => {
        let cleanup = latest.current()
        // A screen coming back into focus: the old pass is stale, a new one starts.
        focus.refocus = () => {
          if (typeof cleanup === 'function') {
            cleanup()
          }
          cleanup = latest.current()
        }
        return () => {
          if (typeof cleanup === 'function') {
            cleanup()
          }
        }
      }, [])
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

import { noteHostMembershipChange } from '../transport/host-list-load-sharing'
import { homeBodyKind } from './home-body-kind'
import { HOME_CATALOG_READ_CAP_MS } from './home-catalog-read'
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
  let latest: ReturnType<typeof useMobileHomeData> | null = null
  let listedIds: string[][] = []

  function Probe() {
    const data = useMobileHomeData()
    latest = data
    listedIds.push(data.hostCatalog.map((h) => h.id))
    loadedFlags.push(data.hostCatalogLoaded)
    kinds.push(homeBodyKind(data.hostCatalogLoaded, data.hostCatalog.length))
    return null
  }

  beforeEach(() => {
    kinds = []
    loadedFlags = []
    listedIds = []
    latest = null
    focus.refocus = null
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
      expect.stringContaining('[home] host catalog first read failed'),
      expect.any(Error)
    )
  })

  it('says the first read failed, and that it shows the pairing screen', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    catalog.load.mockRejectedValue(new Error('keychain unavailable'))
    await mount()
    expect(warn.mock.calls.map((c) => c[0]).join('\n')).toMatch(/first read failed.*pairing screen/)
  })

  it('keeps the list, and says so, when a refocus re-read rejects after a good read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    catalog.load.mockResolvedValueOnce([entry('mac')])
    await mount()
    catalog.load.mockRejectedValueOnce(new Error('keychain locked'))
    await act(async () => focus.refocus?.())
    expect(kinds.at(-1)).toBe('hosts')
    const lines = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(lines).toMatch(/re-read failed.*keeping the list/)
    expect(lines).not.toMatch(/re-read failed.*pairing screen/)
  })

  it('stops waiting on a read that never settles, and lets a later focus try again', async () => {
    vi.useFakeTimers()
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      catalog.load.mockReturnValueOnce(new Promise(() => {}))
      await mount()
      expect(kinds.at(-1)).toBe('loading')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOME_CATALOG_READ_CAP_MS + 1)
      })
      expect(kinds.at(-1)).toBe('pair')
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/timed out after/)
      catalog.load.mockResolvedValueOnce([entry('mac')])
      await act(async () => focus.refocus?.())
      expect(kinds.at(-1)).toBe('hosts')
      // The abandoned pass was dropped, so the retry made its own call.
      expect(catalog.load).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not redraw "Connect your desktop" after the first desktop is paired elsewhere', async () => {
    catalog.load.mockResolvedValueOnce([])
    await mount()
    expect(kinds.at(-1)).toBe('pair')
    // pair-confirm saves the host, then home is focused again.
    noteHostMembershipChange()
    let release: (value: unknown[]) => void = () => {}
    catalog.load.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    kinds.length = 0
    await act(async () => focus.refocus?.())
    expect(kinds).not.toContain('pair')
    await act(async () => release([entry('mac')]))
    expect(kinds.at(-1)).toBe('hosts')
    expect(kinds).not.toContain('pair')
  })

  it('does not list a desktop that was removed elsewhere while the re-read is in flight', async () => {
    catalog.load.mockResolvedValueOnce([entry('mac')])
    await mount()
    expect(kinds.at(-1)).toBe('hosts')
    noteHostMembershipChange()
    let release: (value: unknown[]) => void = () => {}
    catalog.load.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    kinds.length = 0
    await act(async () => focus.refocus?.())
    expect(kinds).not.toContain('hosts')
    await act(async () => release([]))
    expect(kinds.at(-1)).toBe('pair')
  })

  it('keeps the list on screen when only the last-connected stamp changed', async () => {
    catalog.load.mockResolvedValueOnce([entry('mac')])
    await mount()
    catalog.load.mockResolvedValueOnce([entry('mac')])
    kinds.length = 0
    await act(async () => focus.refocus?.())
    expect(kinds).not.toContain('loading')
  })

  it('does not send the next return to loading after home removed a desktop itself', async () => {
    catalog.load.mockResolvedValueOnce([entry('a'), entry('b')])
    await mount()
    // handleRemove: the store removes b (membership moves), then home sets the fresh list.
    noteHostMembershipChange()
    await act(async () => latest!.setHostCatalog([entry('a')] as never))
    let release: (value: unknown[]) => void = () => {}
    catalog.load.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    kinds.length = 0
    await act(async () => focus.refocus?.())
    // Still in flight: home must go on drawing its list, not fall back to loading.
    expect(kinds).not.toContain('loading')
    expect(kinds.at(-1)).toBe('hosts')
    await act(async () => release([entry('a')]))
    expect(kinds.at(-1)).toBe('hosts')
  })

  it('drops a late answer from a timed-out read that predates a local removal', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      catalog.load.mockResolvedValueOnce([entry('a'), entry('b')])
      await mount()
      let late: (value: unknown[]) => void = () => {}
      catalog.load.mockReturnValueOnce(new Promise((resolve) => (late = resolve)))
      await act(async () => focus.refocus?.())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOME_CATALOG_READ_CAP_MS + 1)
      })
      // The user removes b while the stuck read is still out.
      await act(async () => latest!.setHostCatalog([entry('a')] as never))
      await act(async () => late([entry('a'), entry('b')]))
      expect(listedIds.at(-1)).toEqual(['a'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('still applies a late answer when nothing newer has landed', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      let late: (value: unknown[]) => void = () => {}
      catalog.load.mockReturnValueOnce(new Promise((resolve) => (late = resolve)))
      await mount()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOME_CATALOG_READ_CAP_MS + 1)
      })
      await act(async () => late([entry('mac')]))
      expect(listedIds.at(-1)).toEqual(['mac'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let an older overlapping read overwrite a newer one', async () => {
    let first: (value: unknown[]) => void = () => {}
    catalog.load.mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
    await mount()
    catalog.load.mockResolvedValueOnce([entry('new')])
    await act(async () => focus.refocus?.())
    await act(async () => first([entry('old')]))
    expect(listedIds.at(-1)).toEqual(['new'])
  })

  it('words a failed re-read by what is drawn when the last list was empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    catalog.load.mockResolvedValueOnce([])
    await mount()
    catalog.load.mockRejectedValueOnce(new Error('keychain locked'))
    await act(async () => focus.refocus?.())
    expect(kinds.at(-1)).toBe('pair')
    const lines = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(lines).toMatch(/re-read failed; showing the pairing screen/)
    expect(lines).not.toMatch(/keeping the list/)
  })

  it('lets a focus read that started after an unavailable-card re-check win over it', async () => {
    catalog.load.mockResolvedValueOnce([entry('h1')])
    await mount()
    // Tap a temporarily-unavailable card: the re-check starts and is slow.
    let recheck: (value: unknown[]) => void = () => {}
    catalog.load.mockReturnValueOnce(new Promise((resolve) => (recheck = resolve)))
    let recheckDone: Promise<void> = Promise.resolve()
    await act(async () => {
      recheckDone = latest!.recheckHostCatalog()
    })
    // Leave, pair h2 (the write drops the shared read), and come back.
    noteHostMembershipChange()
    let focusRead: (value: unknown[]) => void = () => {}
    catalog.load.mockReturnValueOnce(new Promise((resolve) => (focusRead = resolve)))
    await act(async () => focus.refocus?.())
    // The old re-check lands first, then the newer focus read.
    await act(async () => {
      recheck([entry('h1')])
      await recheckDone
    })
    await act(async () => focusRead([entry('h1'), entry('h2')]))
    expect(listedIds.at(-1)).toEqual(['h1', 'h2'])
  })

  it('applies a re-check that lands with nothing newer, and a failed one rejects to its caller', async () => {
    catalog.load.mockResolvedValueOnce([entry('h1')])
    await mount()
    catalog.load.mockResolvedValueOnce([entry('h1'), entry('h2')])
    await act(async () => latest!.recheckHostCatalog())
    expect(listedIds.at(-1)).toEqual(['h1', 'h2'])
    catalog.load.mockRejectedValueOnce(new Error('keychain'))
    await expect(latest!.recheckHostCatalog()).rejects.toThrow('keychain')
    expect(listedIds.at(-1)).toEqual(['h1', 'h2'])
  })

  it('still drops an older focus read when home removes a desktop itself', async () => {
    catalog.load.mockResolvedValueOnce([entry('a'), entry('b')])
    await mount()
    let stuck: (value: unknown[]) => void = () => {}
    catalog.load.mockReturnValueOnce(new Promise((resolve) => (stuck = resolve)))
    await act(async () => focus.refocus?.())
    // handleRemove: the store removed b, then home applies the fresh list.
    noteHostMembershipChange()
    await act(async () => latest!.setHostCatalog([entry('a')] as never))
    await act(async () => stuck([entry('a'), entry('b')]))
    expect(listedIds.at(-1)).toEqual(['a'])
  })
})
