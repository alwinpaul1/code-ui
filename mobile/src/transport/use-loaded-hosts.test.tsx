import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Settings screens said "No paired desktops yet" / "No paired hosts." over a phone that had a
 * desktop, for the moment their host read was in flight (found 2026-09-29 sweeping the
 * pairing-screen flash). `useLoadedHosts` says when the empty list is an answer.
 */

const store = vi.hoisted(() => ({ loadHosts: vi.fn() }))
vi.mock('./host-store', () => ({ loadHosts: store.loadHosts }))

import { useLoadedHosts } from './use-loaded-hosts'

describe('paired-host list on a settings screen', () => {
  let renderer: ReactTestRenderer | null = null
  let seen: { count: number; loaded: boolean }[] = []

  function Probe() {
    const { hosts, loaded } = useLoadedHosts()
    seen.push({ count: hosts.length, loaded })
    return null
  }
  async function mount() {
    seen = []
    await act(async () => {
      renderer = create(createElement(Probe))
    })
  }
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    store.loadHosts.mockReset()
    vi.restoreAllMocks()
  })

  it('is not "loaded" while the read is in flight, so no screen can claim there are none', async () => {
    store.loadHosts.mockReturnValue(new Promise(() => {}))
    await mount()
    expect(seen.every((s) => !s.loaded)).toBe(true)
  })

  it('reports one and several paired hosts as loaded', async () => {
    store.loadHosts.mockResolvedValue([{ id: 'a' }])
    await mount()
    expect(seen.at(-1)).toEqual({ count: 1, loaded: true })
    act(() => renderer?.unmount())
    store.loadHosts.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    await mount()
    expect(seen.at(-1)).toEqual({ count: 2, loaded: true })
  })

  it('reports an empty finished read as loaded and empty', async () => {
    store.loadHosts.mockResolvedValue([])
    await mount()
    expect(seen.at(-1)).toEqual({ count: 0, loaded: true })
  })

  it('ends the wait, empty, and logs when the read rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.loadHosts.mockRejectedValue(new Error('keychain unavailable'))
    await mount()
    expect(seen.at(-1)).toEqual({ count: 0, loaded: true })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[hosts] paired-host list failed to load'),
      expect.any(Error)
    )
  })
})
