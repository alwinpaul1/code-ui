import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Settings screens said "No paired desktops yet" / "No paired hosts." over a phone that had a
 * desktop, for the moment their host read was in flight (found 2026-09-29 sweeping the
 * pairing-screen flash). `useLoadedHosts` says when the empty list is an answer.
 */

const store = vi.hoisted(() => ({ loadHosts: vi.fn() }))
vi.mock('./host-store', () => ({ loadHostCatalog: store.loadHosts }))

import { emptyHostsNotice, emptyHostsNoticeCopy, useLoadedHosts } from './use-loaded-hosts'

const ready = (id: string) => ({ id, credentialStatus: 'ready', profile: { id } })
const locked = (id: string) => ({ id, credentialStatus: 'temporarily-unavailable', profile: null })

describe('paired-host list on a settings screen', () => {
  let renderer: ReactTestRenderer | null = null
  let seen: { count: number; loaded: boolean; failed: boolean; unreadable: number }[] = []

  function Probe() {
    const { hosts, loaded, failed, unreadable } = useLoadedHosts()
    seen.push({ count: hosts.length, loaded, failed, unreadable })
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
    store.loadHosts.mockResolvedValue([ready('a')])
    await mount()
    expect(seen.at(-1)).toEqual({ count: 1, loaded: true, failed: false, unreadable: 0 })
    act(() => renderer?.unmount())
    store.loadHosts.mockResolvedValue([ready('a'), ready('b')])
    await mount()
    expect(seen.at(-1)).toEqual({ count: 2, loaded: true, failed: false, unreadable: 0 })
  })

  it('reports an empty finished read as loaded and empty', async () => {
    store.loadHosts.mockResolvedValue([])
    await mount()
    expect(seen.at(-1)).toEqual({ count: 0, loaded: true, failed: false, unreadable: 0 })
  })

  it('ends the wait, flags the failure, and logs when the read rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.loadHosts.mockRejectedValue(new Error('keychain unavailable'))
    await mount()
    expect(seen.at(-1)).toEqual({ count: 0, loaded: true, failed: true, unreadable: 0 })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[hosts] paired-host list failed to load'),
      expect.any(Error)
    )
  })

  it('counts a desktop the locked Keychain cannot read instead of calling the list empty', async () => {
    store.loadHosts.mockResolvedValue([locked('a')])
    await mount()
    expect(seen.at(-1)).toEqual({ count: 0, loaded: true, failed: false, unreadable: 1 })
  })
})

describe('what an empty host list may say', () => {
  it('says "none" only when the read finished, worked, and found nothing unreadable', () => {
    expect(emptyHostsNotice({ failed: false, unreadable: 0 })).toBe('none')
    expect(emptyHostsNoticeCopy({ failed: false, unreadable: 0 }, 'No paired hosts.')).toBe(
      'No paired hosts.'
    )
  })

  it('never says "none" over hosts it could not read or a read that failed', () => {
    expect(emptyHostsNotice({ failed: false, unreadable: 2 })).toBe('unreadable')
    expect(emptyHostsNotice({ failed: true, unreadable: 0 })).toBe('failed')
    for (const state of [
      { failed: false, unreadable: 1 },
      { failed: true, unreadable: 0 }
    ]) {
      expect(emptyHostsNoticeCopy(state, 'No paired hosts.')).not.toMatch(/No paired|yet/)
    }
  })
})
