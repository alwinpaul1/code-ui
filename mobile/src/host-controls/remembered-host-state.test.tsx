import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('lucide-react-native', () => ({
  Lock: 'Lock',
  LockOpen: 'LockOpen',
  MonitorOff: 'MonitorOff',
  Sunrise: 'Sunrise',
  Unplug: 'Unplug',
  Volume2: 'Volume2',
  VolumeX: 'VolumeX'
}))
vi.mock('../cache/worktree-cache', () => ({ getCachedWorktrees: () => null }))
// Why: expo-secure-store reaches for expo-modules-core's native EventEmitter.
vi.mock('./mac-unlock-password-store', () => ({
  readMacUnlockPassword: vi.fn(async () => null),
  clearMacUnlockPassword: vi.fn(async () => undefined)
}))
// The phone's key-value store, kept in a map that outlives an unmount, so a test can
// restart the app and read back what the last run wrote.
const storage = vi.hoisted(() => ({
  items: new Map<string, string>(),
  failReads: false
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (storage.failReads) {
        throw new Error('store unreadable')
      }
      return storage.items.get(key) ?? null
    },
    setItem: async (key: string, value: string) => {
      storage.items.set(key, value)
    },
    removeItem: async (key: string) => {
      storage.items.delete(key)
    }
  }
}))

import {
  HOSTS,
  LOCKED_MUTED,
  elapse,
  fakeHost,
  propsFor,
  render,
  reopen,
  resetHarness,
  rows,
  runFromMenu,
  states,
  unmountHarness,
  type FakeHost,
  type MenuProps
} from './use-mac-host-controls-test-harness'

beforeEach(() => {
  vi.useFakeTimers()
  resetHarness()
  storage.items.clear()
  storage.failReads = false
})

afterEach(() => {
  unmountHarness()
  vi.useRealTimers()
})

describe('the host menu opened first on a new connection, after the host said something before', () => {
  const NO_HISTORY_ROWS = {
    darwin: ['Lock Mac', 'Sleep display', 'Wake display', 'Mute Mac', 'Unmute Mac'],
    win32: ['Lock PC', 'Mute PC', 'Unmute PC']
  } as const
  const UNKNOWN_MARKER = {
    darwin: 'CUIMAC lock=0 mute=unknown display=unknown end',
    win32: 'CUIWIN mute=unknown end'
  } as const

  /** Opens the menu, lets the host answer `answer`, and closes it. */
  async function learn(host: FakeHost, props: MenuProps, answer: string) {
    render({ ...props, openHostId: null })
    await elapse(10)
    host.answer = answer
    render({ ...props, openHostId: host.hostId })
    await elapse(600)
    render({ ...props, openHostId: null })
    await elapse(10)
  }

  /** The link drops and comes back: a new connection, and the host is slow to answer. */
  async function reconnect(host: FakeHost, props: MenuProps) {
    const dropped = props.clients.map((entry) => ({ ...entry, state: 'disconnected' as const }))
    render({ ...props, clients: dropped, openHostId: null })
    await elapse(10)
    host.connectedAt = (host.connectedAt ?? 0) + 1
    host.answer = null
    render({ ...props, openHostId: null })
    await elapse(10)
  }

  /** The app is killed and started again: nothing in memory, only the store. */
  async function restart(host: FakeHost, props: MenuProps) {
    unmountHarness()
    host.answer = null
    render({ ...props, openHostId: null })
    await elapse(10)
  }

  for (const { platform, noun, marker } of HOSTS) {
    it(`a first open on a new connection shows one display row and one mute row from what the ${noun} said last time`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      await learn(host, props, marker(true, 'on'))
      await reconnect(host, props)
      reopen(host, props)
      expect(states).not.toContain('checking')
      expect(rows()).toEqual(
        platform === 'win32' ? ['Lock PC', 'Unmute PC'] : ['Lock Mac', 'Sleep display', 'Unmute Mac']
      )
      // It still asks, and what the host says now replaces the remembered rows.
      host.answer = marker(false, 'off')
      await elapse(600)
      expect(rows()).toEqual(platform === 'win32' ? ['Lock PC', 'Mute PC'] : ['Lock Mac', 'Wake display', 'Mute Mac'])
    })

    it(`a first open after an app restart shows one display row and one mute row from what the ${noun} said last time`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      await learn(host, props, marker(true, 'off'))
      await restart(host, props)
      reopen(host, props)
      expect(states).not.toContain('checking')
      expect(rows()).toEqual(
        platform === 'win32' ? ['Lock PC', 'Unmute PC'] : ['Lock Mac', 'Wake display', 'Unmute Mac']
      )
    })

    it(`a ${noun} check that cannot read the display or the sound does not erase what was remembered`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      await learn(host, props, marker(true, 'on'))
      await restart(host, props)
      await learn(host, props, UNKNOWN_MARKER[platform])
      await restart(host, props)
      reopen(host, props)
      expect(rows()).toEqual(
        platform === 'win32' ? ['Lock PC', 'Unmute PC'] : ['Lock Mac', 'Sleep display', 'Unmute Mac']
      )
    })

    it(`remembers what a ${noun} action that finished OK left behind`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      host.answer = marker(false, 'on')
      await runFromMenu(host, props, 'mute')
      await elapse(5000)
      await restart(host, props)
      reopen(host, props)
      expect(rows()).toContain(`Unmute ${noun}`)
      expect(rows()).not.toContain(`Mute ${noun}`)
    })

    // A row that did not finish may have half-run, so what was kept about the host is
    // no longer trusted, after a restart either (the same rule as on one connection).
    it(`forgets what it kept about the ${noun} after a row that did not finish`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      host.answer = marker(false, 'on')
      host.actionMode = 'stuck'
      await runFromMenu(host, props, 'mute')
      // Past both platforms' command timeouts.
      await elapse(16_000)
      await restart(host, props)
      reopen(host, props)
      expect(rows()).toEqual(NO_HISTORY_ROWS[platform])
      expect(storage.items.size).toBe(0)
    })

    it(`a first open with no history of the ${noun} still offers both rows of each pair`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      await restart(host, props)
      await reconnect(host, props)
      reopen(host, props)
      expect(states).not.toContain('checking')
      expect(rows()).toEqual(NO_HISTORY_ROWS[platform])
    })

    it(`ignores an unreadable store, says why in one line, and offers both rows of each ${noun} pair`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      await learn(host, props, marker(true, 'on'))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      storage.failReads = true
      await restart(host, props)
      reopen(host, props)
      expect(states).not.toContain('checking')
      expect(rows()).toEqual(NO_HISTORY_ROWS[platform])
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('could not read the remembered host state'),
        expect.any(Error)
      )
      warn.mockRestore()
    })

    for (const [what, stored] of [
      ['not JSON', '{display'],
      ['a value no host gives', JSON.stringify({ display: 'sideways', mute: 'muted' })]
    ] as const) {
      it(`ignores a remembered ${noun} state that is ${what}, says why, and offers both rows of each pair`, async () => {
        const host = fakeHost('host', platform)
        const props = propsFor(host)
        await learn(host, props, marker(true, 'on'))
        expect(storage.items.size).toBe(1)
        for (const key of storage.items.keys()) {
          storage.items.set(key, stored)
        }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        await restart(host, props)
        reopen(host, props)
        expect(rows()).toEqual(NO_HISTORY_ROWS[platform])
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('ignored the remembered host state'))
        warn.mockRestore()
      })
    }
  }

  // Unlock types the password into whatever is in front on the Mac
  // (mac-host-sheet-actions.ts), so a locked Mac remembered from last time must not
  // bring it back before this connection's own check says so.
  it('never offers Unlock from memory, after a reconnect or a restart', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    await learn(host, props, LOCKED_MUTED)
    await reconnect(host, props)
    reopen(host, props)
    expect(rows()).toEqual(['Lock Mac', 'Wake display', 'Unmute Mac'])
    render({ ...props, openHostId: null })
    await restart(host, props)
    reopen(host, props)
    expect(rows()).toEqual(['Lock Mac', 'Wake display', 'Unmute Mac'])
    expect(storage.items.size).toBe(1)
    for (const value of storage.items.values()) {
      expect(Object.keys(JSON.parse(value) as object).sort()).toEqual(['display', 'mute'])
    }
    host.answer = LOCKED_MUTED
    await elapse(600)
    expect(rows()).toEqual(['Unlock Mac', 'Wake display', 'Unmute Mac'])
  })
})
