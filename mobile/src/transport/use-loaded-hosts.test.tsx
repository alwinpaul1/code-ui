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

import { emptyHostsNoticeCopy, useLoadedHosts } from './use-loaded-hosts'

const ready = (id: string) => ({ id, credentialStatus: 'ready', profile: { id } })
const locked = (id: string) => ({ id, credentialStatus: 'temporarily-unavailable', profile: null })
const missingCred = (id: string) => ({ id, credentialStatus: 'missing', profile: null })

describe('paired-host list on a settings screen', () => {
  let renderer: ReactTestRenderer | null = null
  let seen: {
    count: number
    loaded: boolean
    failed: boolean
    unavailable: number
    missing: number
  }[] = []

  function Probe() {
    const { hosts, loaded, failed, unavailable, missing } = useLoadedHosts()
    seen.push({ count: hosts.length, loaded, failed, unavailable, missing })
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
    expect(seen.at(-1)).toEqual({
      count: 1,
      loaded: true,
      failed: false,
      unavailable: 0,
      missing: 0
    })
    act(() => renderer?.unmount())
    store.loadHosts.mockResolvedValue([ready('a'), ready('b')])
    await mount()
    expect(seen.at(-1)).toEqual({
      count: 2,
      loaded: true,
      failed: false,
      unavailable: 0,
      missing: 0
    })
  })

  it('reports an empty finished read as loaded and empty', async () => {
    store.loadHosts.mockResolvedValue([])
    await mount()
    expect(seen.at(-1)).toEqual({
      count: 0,
      loaded: true,
      failed: false,
      unavailable: 0,
      missing: 0
    })
  })

  it('ends the wait, flags the failure, and logs when the read rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.loadHosts.mockRejectedValue(new Error('keychain unavailable'))
    await mount()
    expect(seen.at(-1)).toEqual({
      count: 0,
      loaded: true,
      failed: true,
      unavailable: 0,
      missing: 0
    })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[hosts] paired-host list failed to load'),
      expect.any(Error)
    )
  })

  it('counts a desktop with no credential apart from one that is only unreadable now', async () => {
    store.loadHosts.mockResolvedValue([missingCred('a'), locked('b')])
    await mount()
    expect(seen.at(-1)).toEqual({
      count: 0,
      loaded: true,
      failed: false,
      unavailable: 1,
      missing: 1
    })
  })

  it('counts a desktop the locked Keychain cannot read instead of calling the list empty', async () => {
    store.loadHosts.mockResolvedValue([locked('a')])
    await mount()
    expect(seen.at(-1)).toEqual({
      count: 0,
      loaded: true,
      failed: false,
      unavailable: 1,
      missing: 0
    })
  })
})

describe('what an empty host list may say', () => {
  const none = { failed: false, unavailable: 0, missing: 0 }

  it('says "none" only when the read finished, worked, and the catalog lists nothing', () => {
    expect(emptyHostsNoticeCopy(none, 'No paired hosts.')).toBe('No paired hosts.')
  })

  it('never says "none" over a read that failed', () => {
    const copy = emptyHostsNoticeCopy({ ...none, failed: true }, 'No paired hosts.')
    expect(copy).toMatch(/Couldn't read/)
    expect(copy).not.toMatch(/No paired|yet/)
  })

  it('says a desktop that cannot be read right now is that, without telling anyone to unlock', () => {
    const copy = emptyHostsNoticeCopy({ ...none, unavailable: 2 }, 'No paired hosts.')
    expect(copy).toMatch(/can't be read right now/)
    expect(copy).not.toMatch(/unlock|No paired|yet/i)
  })

  it('says a desktop with no credential needs pairing again, not that it cannot be read', () => {
    const copy = emptyHostsNoticeCopy({ ...none, missing: 1 }, 'No paired hosts.')
    expect(copy).toMatch(/paired again/)
    expect(copy).not.toMatch(/can't be read|unlock|No paired hosts/i)
  })

  it('matches the wording to the count, one and several', () => {
    const copy = (unavailable: number, missing: number) =>
      emptyHostsNoticeCopy({ failed: false, unavailable, missing }, 'x')
    expect(copy(1, 0)).toMatch(/^A paired desktop can't be read/)
    expect(copy(3, 0)).toMatch(/^Your paired desktops can't be read/)
    expect(copy(0, 1)).toMatch(/^A paired desktop needs to be paired again/)
    expect(copy(0, 3)).toMatch(/^3 paired desktops need to be paired again\. Scan their codes/)
    expect(copy(0, 3)).not.toMatch(/needs/)
  })

  it('says both when some desktops are unreadable and some need pairing', () => {
    const copy = emptyHostsNoticeCopy({ ...none, unavailable: 1, missing: 1 }, 'x')
    expect(copy).toMatch(/can't be read right now/)
    expect(copy).toMatch(/paired again/)
  })
})
