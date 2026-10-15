import { act } from 'react-test-renderer'
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

import { EXPECTED_HOST_STATE_FRESH_MS } from './mac-host-expected-state'
import { UNKNOWN_MAC_HOST_STATE } from './mac-host-state'
import { MAC_HOST_STATE_PROBE_TIMEOUT_MS, WINDOWS_HOST_STATE_PROBE_TIMEOUT_MS } from './probe-mac-host-state'
import { getMacHostSheetActions } from './mac-host-sheet-actions'
import {
  HOSTS,
  LOCKED_MUTED,
  LOCKED_MUTED_STATE,
  UNLOCKED_AWAKE,
  UNLOCKED_AWAKE_STATE,
  checkingFor,
  clientsOf,
  elapse,
  fakeHost,
  infoFor,
  isProbe,
  hook,
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

describe('the host menu while it checks the host', () => {
  // 2026-09-26: "Checking the Mac…" stayed up for a long time. The home screen
  // replaces its workspace info on every return to it and every reconnect, and
  // its platform map whenever a host names its platform; the check restarted on
  // each, opening another tab on the desktop and waiting all over again.
  it('keeps the one check it started when the home screen refreshes around it', async () => {
    const mac = fakeHost('mac', 'darwin')
    const pc = fakeHost('pc', 'win32')
    render({ clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') }, openHostId: null })
    await elapse(10)
    render({ clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') }, openHostId: 'mac' })
    await elapse(300)
    expect(mac.probes()).toBe(1)

    // Same workspaces, fetched again; and a second host connects and names its platform.
    render({ clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') }, openHostId: 'mac' })
    await elapse(300)
    render({ clients: clientsOf(mac, pc), worktreeInfo: { mac: infoFor('mac'), pc: infoFor('pc') }, openHostId: 'mac' })
    await elapse(300)
    // Nothing known yet: every row but Unlock, drawn at once (2026-10-14).
    expect(hook.latest?.macOptions?.state).toEqual(UNKNOWN_MAC_HOST_STATE)

    mac.answer = LOCKED_MUTED
    await elapse(400)
    expect(hook.latest?.macOptions?.state).toEqual(LOCKED_MUTED_STATE)
    expect(mac.probes()).toBe(1)
  })

  // Review, 2026-09-26: a cold start seeds the workspace from the last snapshot, and
  // a workspace deleted on the desktop since then cannot open the probe's tab.
  it('asks again once the live workspace list replaces a stale remembered one', async () => {
    const mac = fakeHost('mac', 'darwin')
    mac.answer = UNLOCKED_AWAKE
    render({ clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac', 'deleted-wt') }, openHostId: null })
    await elapse(10)
    render({ clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac', 'deleted-wt') }, openHostId: 'mac' })
    await elapse(200)
    render({ clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') }, openHostId: 'mac' })
    await elapse(400)
    expect(hook.latest?.macOptions?.state).toEqual(UNLOCKED_AWAKE_STATE)
    expect(mac.probes()).toBe(1)
  })

  // Until 2026-10-14 this pinned the opposite, "never draws what an earlier open
  // said", and that was the bug the user reported: the rows vanished behind
  // "Checking" on every open. The lock alone stays unasserted until this open asks.
  it('draws what an earlier open said, lock unasserted, until this open has its own answer', async () => {
    const mac = fakeHost('mac', 'darwin')
    const props = { clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') } }
    render({ ...props, openHostId: null })
    await elapse(10)
    mac.answer = LOCKED_MUTED
    render({ ...props, openHostId: 'mac' })
    await elapse(400)
    expect(hook.latest?.macOptions?.state).toEqual(LOCKED_MUTED_STATE)

    render({ ...props, openHostId: null })
    mac.answer = null
    states.length = 0
    render({ ...props, openHostId: 'mac' })
    await elapse(400)
    expect(states).not.toContain('checking')
    expect(hook.latest?.macOptions?.state).toEqual({ ...LOCKED_MUTED_STATE, lock: 'unknown' })
    mac.answer = UNLOCKED_AWAKE
    await elapse(400)
    expect(hook.latest?.macOptions?.state).toEqual(UNLOCKED_AWAKE_STATE)
  })
})

describe('the host menu after one of its rows ran', () => {
  // The action closes the sheet and the next open asks the host again, so a second
  // probe three seconds after the action was a desktop tab nobody read.
  it('opens no tab on the desktop beyond the action itself', async () => {
    const mac = fakeHost('mac', 'darwin')
    const props = { clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') } }
    render({ ...props, openHostId: null })
    await elapse(10)
    mac.answer = UNLOCKED_AWAKE
    render({ ...props, openHostId: 'mac' })
    await elapse(400)
    const onAction = hook.latest?.macOptions?.onAction
    render({ ...props, openHostId: null })
    act(() => onAction?.('mute'))
    await elapse(10_000)
    expect(mac.created).toHaveLength(2)
    expect(mac.probes()).toBe(1)
  })

  // Review, 2026-09-26: with the second probe gone, a menu reopened while its action
  // was still running read the host before the action took, and kept that answer.
  it('reads the host after its action has taken when the menu is reopened straight away', async () => {
    const mac = fakeHost('mac', 'darwin')
    const props = { clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') } }
    render({ ...props, openHostId: null })
    await elapse(10)
    mac.answer = UNLOCKED_AWAKE
    render({ ...props, openHostId: 'mac' })
    await elapse(400)
    const onAction = hook.latest?.macOptions?.onAction
    render({ ...props, openHostId: null })
    mac.afterAction = 'CUIMAC lock=0 mute=false display=off end'
    act(() => onAction?.('sleep-display'))
    render({ ...props, openHostId: 'mac' })
    await elapse(100)
    // The display is still settling: the menu says it is checking, not the old rows.
    expect(hook.latest?.macOptions?.state).toBe('checking')
    // Stepped: act flushes the settled state at the end of each step, and the probe it
    // starts needs timers of its own.
    await elapse(3500)
    await elapse(500)
    expect(hook.latest?.macOptions?.state).toEqual({ lock: 'unlocked', display: 'off', mute: 'unmuted' })
    expect(mac.probes()).toBe(2)
  })

  // Third review, 2026-09-26: Unlock spends 3.3 s by design before it types, and a
  // 5 s cap on the wait let the check read the login window before it let the user in.
  it('reads the Mac unlocked when its menu is reopened straight after a slow Unlock', async () => {
    const mac = fakeHost('mac', 'darwin')
    const props = { clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') } }
    render({ ...props, openHostId: null })
    await elapse(10)
    mac.answer = LOCKED_MUTED
    mac.afterAction = 'CUIMAC lock=0 mute=true display=on end'
    mac.actionDoneAfterMs = 4800
    mac.afterActionLagMs = 800
    act(() => hook.latest?.onPasswordSaved('mac', 'hunter2'))
    await elapse(500)
    render({ ...props, openHostId: 'mac' })
    const waited = await checkingFor(20_000)
    expect(waited).not.toBeNull()
    expect(waited!).toBeLessThanOrEqual(MAC_HOST_STATE_PROBE_TIMEOUT_MS)
    // The Unlock that finished is drawn first, as Lock alone; the check then says
    // what the Mac is.
    expect(hook.latest?.macOptions?.state).toMatchObject({ lock: 'unknown' })
    // Stepped, so the gate falling renders and starts the check inside the wait.
    for (let step = 0; step < MAC_HOST_STATE_PROBE_TIMEOUT_MS; step += 500) {
      await elapse(500)
    }
    expect(hook.latest?.macOptions?.state).toEqual({ lock: 'unlocked', display: 'on', mute: 'muted' })
  })

  // Second review, 2026-09-26: the menu waited out the whole action before asking, so
  // an action that never finished kept "Checking" up past the 12 s the check has.
  it('keeps a menu reopened during an action that never finishes inside the 12 s the check has', async () => {
    const mac = fakeHost('mac', 'darwin')
    const props = { clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') } }
    render({ ...props, openHostId: null })
    await elapse(10)
    mac.answer = UNLOCKED_AWAKE
    render({ ...props, openHostId: 'mac' })
    await elapse(400)
    const onAction = hook.latest?.macOptions?.onAction
    render({ ...props, openHostId: null })
    mac.actionMode = 'stuck'
    act(() => onAction?.('lock'))
    await elapse(500)
    render({ ...props, openHostId: 'mac' })
    const waited = await checkingFor(20_000)
    expect(waited).not.toBeNull()
    expect(waited!).toBeLessThanOrEqual(MAC_HOST_STATE_PROBE_TIMEOUT_MS)
    expect(hook.latest?.macOptions?.state).toEqual(UNLOCKED_AWAKE_STATE)
  })

  it('gives a check that waited on an action only what is left of its 12 s', async () => {
    const mac = fakeHost('mac', 'darwin')
    const props = { clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') } }
    render({ ...props, openHostId: null })
    await elapse(10)
    mac.answer = UNLOCKED_AWAKE
    render({ ...props, openHostId: 'mac' })
    await elapse(400)
    const onAction = hook.latest?.macOptions?.onAction
    render({ ...props, openHostId: null })
    act(() => onAction?.('mute'))
    render({ ...props, openHostId: 'mac' })
    // The host never answers the check that follows. The rows Mute left behind are
    // drawn meanwhile (2026-10-10), so the budget is read off the check's own tab:
    // the third one opened, closed when the check gives up.
    mac.answer = null
    const probeClosed = () =>
      vi.mocked(mac.client.sendRequest).mock.calls.some(
        ([method, params]) => method === 'session.tabs.close' && (params as { tabId?: string }).tabId === 'mac-term-3-tab'
      )
    let waited = 0
    while (!probeClosed() && waited <= 20_000) {
      await elapse(100)
      waited += 100
    }
    expect(probeClosed()).toBe(true)
    // One screen read may be in flight when the budget runs out.
    expect(waited).toBeLessThanOrEqual(MAC_HOST_STATE_PROBE_TIMEOUT_MS + 300)
    expect(hook.latest?.macOptions?.state).toEqual({ lock: 'unlocked', display: 'on', mute: 'muted' })
  })

  it('does not leave the menu checking for good when an action throws', async () => {
    const mac = fakeHost('mac', 'darwin')
    const props = { clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') } }
    render({ ...props, openHostId: null })
    await elapse(10)
    mac.answer = UNLOCKED_AWAKE
    render({ ...props, openHostId: 'mac' })
    await elapse(400)
    const onAction = hook.latest?.macOptions?.onAction
    render({ ...props, openHostId: null })
    mac.actionMode = 'throw'
    act(() => onAction?.('lock'))
    await elapse(10)
    // The failure is said, in words that name the host and nothing it was sent.
    expect(hook.latest?.toast).toBe('The Mac did not answer.')
    states.length = 0
    render({ ...props, openHostId: 'mac' })
    // The throw may have half-run: nothing known is trusted, so every row but
    // Unlock, at once, until the Mac says again.
    expect(states).not.toContain('checking')
    expect(hook.latest?.macOptions?.state).toEqual(UNKNOWN_MAC_HOST_STATE)
    await elapse(600)
    expect(hook.latest?.macOptions?.state).toEqual(UNLOCKED_AWAKE_STATE)
  })

  it("never shows one host's state in another host's menu", async () => {
    const mac = fakeHost('mac', 'darwin')
    const other = fakeHost('other', 'darwin')
    const props = {
      clients: clientsOf(mac, other),
      worktreeInfo: { mac: infoFor('mac'), other: infoFor('other') }
    }
    render({ ...props, openHostId: null })
    await elapse(10)
    mac.answer = LOCKED_MUTED
    render({ ...props, openHostId: 'mac' })
    await elapse(400)
    const onAction = hook.latest?.macOptions?.onAction
    render({ ...props, openHostId: null })
    act(() => onAction?.('unmute'))
    await elapse(500)
    // The other Mac is slow to answer; its sheet must draw nothing it learnt from
    // the first one, only the rows of a host that has not said.
    render({ ...props, openHostId: 'other' })
    await elapse(5000)
    expect(hook.latest?.macOptions?.state).toEqual(UNKNOWN_MAC_HOST_STATE)
    other.answer = UNLOCKED_AWAKE
    await elapse(400)
    expect(hook.latest?.macOptions?.state).toEqual(UNLOCKED_AWAKE_STATE)
  })
})

// Review, 2026-09-26: Unlock types the password into whatever is in front on the
// Mac, so the command types nothing unless the screen is locked when it runs. The
// user must be told which happened, and never shown the password doing it.
describe('the host menu when an Unlock typed nothing', () => {
  for (const [marker, toast] of [
    ['CUIREFUSED unlocked', "The Mac isn't locked, so nothing was typed."],
    ['CUIREFUSED unconfirmed', "Couldn't confirm the Mac is locked, so nothing was typed."]
  ] as const) {
    it(`says "${toast}" as soon as the Mac says so`, async () => {
      const mac = fakeHost('mac', 'darwin')
      mac.actionScreen = [marker]
      render({ clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') }, openHostId: null })
      await elapse(10)
      act(() => hook.latest?.onPasswordSaved('mac', 'fake-pw-not-real'))
      await elapse(1000)
      expect(hook.latest?.toast).toBe(toast)
      expect(mac.created).toHaveLength(1)
      expect(mac.created[0]).toContain('fake-pw-not-real')
      expect(hook.latest?.toast).not.toContain('fake-pw-not-real')
    })
  }
})

// Aravind, 2026-10-10 (Windows): after every row he ran, reopening the menu sat on
// "Checking the PC…" for several seconds before the rows came back. Every open
// forgot the last answer and asked again in a new PowerShell. An action that
// finished OK now leaves its state behind, drawn at once, while the check runs
// behind it.

describe('the host menu reopened after one of its rows finished', () => {
  for (const { platform, noun, marker } of HOSTS) {
    it(`shows Unmute at once, with no checking row, after Mute finished on a ${noun}`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      host.answer = marker(false, 'on')
      host.afterAction = marker(true, 'on')
      await runFromMenu(host, props, 'mute')
      reopen(host, props)
      expect(states).not.toContain('checking')
      expect(rows()).toContain(`Unmute ${noun}`)
      expect(rows()).not.toContain(`Mute ${noun}`)
      // The check still runs, once, after the host has settled, behind the rows.
      expect(host.probes()).toBe(1)
      await elapse(3500)
      await elapse(1000)
      expect(host.probes()).toBe(2)
      expect(states).not.toContain('checking')
      expect(rows()).toContain(`Unmute ${noun}`)
    })

  }

  it('shows Wake display at once after Sleep display finished on a Mac', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    host.answer = HOSTS[0].marker(false, 'on')
    host.afterAction = HOSTS[0].marker(false, 'off')
    await runFromMenu(host, props, 'sleep-display')
    reopen(host, props)
    expect(states).not.toContain('checking')
    expect(rows()).toContain('Wake display')
    expect(rows()).not.toContain('Sleep display')
    // What the menu knew before about the sound is still drawn.
    expect(rows()).toContain('Mute Mac')
    expect(rows()).not.toContain('Unmute Mac')
  })

  it('lets what the host says next replace the rows it expected', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    host.answer = UNLOCKED_AWAKE
    // Someone unmuted it again at the desk.
    host.afterAction = UNLOCKED_AWAKE
    await runFromMenu(host, props, 'mute')
    reopen(host, props)
    expect(rows()).toContain('Unmute Mac')
    await elapse(3500)
    await elapse(1000)
    expect(rows()).toContain('Mute Mac')
    expect(rows()).not.toContain('Unmute Mac')
    expect(states).not.toContain('checking')
  })

  it('keeps the expected rows when the check that follows gets no answer', async () => {
    const host = fakeHost('host', 'win32')
    const props = propsFor(host)
    host.answer = HOSTS[1].marker(false, 'on')
    await runFromMenu(host, props, 'mute')
    host.answer = null
    reopen(host, props)
    await elapse(20_000)
    expect(host.probes()).toBe(2)
    expect(states).not.toContain('checking')
    expect(rows()).toContain('Unmute PC')
    expect(rows()).not.toContain('Mute PC')
  })

  it('offers every row but Unlock again when reopened after a row that did not finish', async () => {
    const host = fakeHost('host', 'win32')
    const props = propsFor(host)
    host.answer = HOSTS[1].marker(false, 'on')
    host.actionMode = 'stuck'
    await runFromMenu(host, props, 'mute')
    await elapse(16_000)
    expect(hook.latest?.toast).toBe('The PC did not finish that. Check the desktop.')
    reopen(host, props)
    expect(hook.latest?.macOptions?.state).toEqual(UNKNOWN_MAC_HOST_STATE)
  })

  // Review, 2026-10-10: the rows the last action left behind stayed drawn, and
  // tappable, while the next action was still running, so a second Unlock could
  // overlap the first one.
  it('says it is checking while the next row is still running', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    host.answer = UNLOCKED_AWAKE
    await runFromMenu(host, props, 'mute')
    reopen(host, props)
    expect(rows()).toContain('Unmute Mac')
    const onAction = hook.latest?.macOptions?.onAction
    render({ ...props, openHostId: null })
    host.actionMode = 'stuck'
    act(() => onAction?.('sleep-display'))
    await elapse(300)
    reopen(host, props)
    expect(hook.latest?.macOptions?.state).toBe('checking')
  })

  it('forgets what it expected after a row failed, even when the one before it finished', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    host.answer = UNLOCKED_AWAKE
    await runFromMenu(host, props, 'mute')
    reopen(host, props)
    const onAction = hook.latest?.macOptions?.onAction
    render({ ...props, openHostId: null })
    host.actionMode = 'stuck'
    act(() => onAction?.('unmute'))
    await elapse(11_000)
    expect(hook.latest?.toast).toBe('The Mac did not finish that. Check the desktop.')
    reopen(host, props)
    expect(hook.latest?.macOptions?.state).toEqual(UNKNOWN_MAC_HOST_STATE)
  })

  // Until 2026-10-14 this said "Checking" again past the two minutes; now the rows
  // stay, as after any probe, and only an Unlock from our own Lock lapses with it.
  it('still shows the rows a row left behind two minutes later, without offering Unlock from them', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    host.answer = UNLOCKED_AWAKE
    await runFromMenu(host, props, 'lock')
    await elapse(EXPECTED_HOST_STATE_FRESH_MS)
    host.answer = null
    reopen(host, props)
    expect(states).not.toContain('checking')
    expect(rows()).toEqual(['Lock Mac', 'Sleep display', 'Mute Mac'])
  })

  it('says it is checking again after the host reconnected', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    host.answer = UNLOCKED_AWAKE
    await runFromMenu(host, props, 'mute')
    host.connectedAt = 2
    reopen(host, props)
    expect(hook.latest?.macOptions?.state).toBe('checking')
  })

  it('offers Unlock at once after Lock finished on a Mac', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    host.answer = UNLOCKED_AWAKE
    host.afterAction = 'CUIMAC lock=1 mute=false display=on end'
    await runFromMenu(host, props, 'lock')
    reopen(host, props)
    expect(states).not.toContain('checking')
    expect(rows()).toContain('Unlock Mac')
    expect(rows()).not.toContain('Lock Mac')
  })

  it('keeps offering Lock PC after Lock finished on a PC, which has no Unlock', async () => {
    const host = fakeHost('host', 'win32')
    const props = propsFor(host)
    host.answer = HOSTS[1].marker(false, 'on')
    await runFromMenu(host, props, 'lock')
    reopen(host, props)
    expect(states).not.toContain('checking')
    expect(rows()).toEqual(['Lock PC', 'Mute PC'])
  })

  it('never offers Unlock from what it expects without a Lock behind it', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    host.answer = LOCKED_MUTED
    host.afterAction = 'CUIMAC lock=1 mute=false display=off end'
    await runFromMenu(host, props, 'unmute')
    reopen(host, props)
    expect(states).not.toContain('checking')
    expect(rows()).toContain('Lock Mac')
    expect(rows()).not.toContain('Unlock Mac')
    // Once the Mac itself says it is locked, Unlock is back.
    await elapse(3500)
    await elapse(1000)
    expect(rows()).toContain('Unlock Mac')
  })
})

// 2026-10-10, the user removed Sleep display and Wake display from Windows. The
// sheet offers neither on a PC; one that reaches the hook anyway (a stale sheet, a
// future caller) runs nothing on the PC and says nothing, as Unlock always did there.
describe('Sleep display and Wake display on a Windows PC', () => {
  for (const action of ['sleep-display', 'wake-display', 'unlock'] as const) {
    it(`runs nothing on the PC when ${action} reaches it anyway`, async () => {
      const host = fakeHost('pc', 'win32')
      host.answer = 'CUIWIN mute=false end'
      const props = propsFor(host)
      render({ ...props, openHostId: null })
      await elapse(10)
      render({ ...props, openHostId: host.hostId })
      await elapse(600)
      expect(rows()).toEqual(['Lock PC', 'Mute PC'])
      const onAction = hook.latest?.macOptions?.onAction
      render({ ...props, openHostId: null })
      act(() => onAction?.(action))
      await elapse(2000)
      expect(host.created.filter((command) => !isProbe(command))).toEqual([])
      expect(hook.latest?.toast).toBeNull()
    })
  }

  it('still runs Mute on the PC', async () => {
    const host = fakeHost('pc', 'win32')
    host.answer = 'CUIWIN mute=false end'
    const props = propsFor(host)
    render({ ...props, openHostId: null })
    await elapse(10)
    render({ ...props, openHostId: host.hostId })
    await elapse(600)
    const onAction = hook.latest?.macOptions?.onAction
    render({ ...props, openHostId: null })
    act(() => onAction?.('mute'))
    await elapse(10)
    expect(hook.latest?.toast).toBe('Muting the PC…')
    expect(host.created.filter((command) => !isProbe(command))).toHaveLength(1)
  })
})

// 2026-10-14, the user, with two screenshots of the same Mac's menu: the first open
// listed Lock, Sleep display, Wake display, Mute and Unmute; the next open of the
// same menu showed one disabled "Checking the Mac…" row in their place, at a
// different sheet height, for as long as the host took to start a shell and answer
// ("checking for mac taking too long time, same for windows"). Every open threw the
// last answer away and hid the rows until the host answered again.
describe('the host menu opened a second time on the same connection', () => {
  async function openOnce(host: FakeHost, props: MenuProps) {
    render({ ...props, openHostId: null })
    await elapse(10)
    render({ ...props, openHostId: host.hostId })
    await elapse(600)
    expect(hook.latest?.macOptions?.state).not.toBe('checking')
    render({ ...props, openHostId: null })
    await elapse(10)
  }

  for (const { platform, noun, marker } of HOSTS) {
    it(`shows the ${noun} actions at once on a second open`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      host.answer = marker(true, 'on')
      await openOnce(host, props)
      // The host is slow to answer this time.
      host.answer = null
      reopen(host, props)
      expect(states).not.toContain('checking')
      expect(rows()).toEqual(
        platform === 'win32' ? ['Lock PC', 'Unmute PC'] : ['Lock Mac', 'Sleep display', 'Unmute Mac']
      )
      await elapse(3000)
      expect(states).not.toContain('checking')
      // It still asks, behind the rows, and what the host says next replaces them.
      expect(host.probes()).toBe(2)
      host.answer = marker(false, 'on')
      await elapse(400)
      expect(rows()).toContain(`Mute ${noun}`)
      expect(rows()).not.toContain(`Unmute ${noun}`)
    })

    it(`keeps the last ${noun} rows when the check on a later open never answers`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      host.answer = marker(true, 'on')
      await openOnce(host, props)
      host.answer = null
      reopen(host, props)
      await elapse(20_000)
      expect(host.probes()).toBe(2)
      expect(states).not.toContain('checking')
      // Not every row, as an unknown answer draws: a check that got nothing is no
      // evidence the host changed.
      expect(rows()).toContain(`Unmute ${noun}`)
      expect(rows()).not.toContain(`Mute ${noun}`)
    })

    it(`keeps the last ${noun} rows when the host refuses the check on a later open`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      host.answer = marker(true, 'on')
      await openOnce(host, props)
      // The workspace the check runs in is gone: createTerminal is refused.
      host.liveWorktree = 'elsewhere'
      reopen(host, props)
      await elapse(2000)
      expect(states).not.toContain('checking')
      expect(rows()).toContain(`Unmute ${noun}`)
      expect(rows()).not.toContain(`Mute ${noun}`)
    })

    it(`gives up on a first-open ${noun} check that never answers within its budget, and still offers the actions`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      render({ ...props, openHostId: null })
      await elapse(10)
      render({ ...props, openHostId: host.hostId })
      const waited = await checkingFor(20_000)
      expect(waited).not.toBeNull()
      expect(waited!).toBeLessThanOrEqual(
        (platform === 'win32' ? WINDOWS_HOST_STATE_PROBE_TIMEOUT_MS : MAC_HOST_STATE_PROBE_TIMEOUT_MS) + 300
      )
      expect(rows()).toContain(`Lock ${noun}`)
      expect(rows()).toContain(`Mute ${noun}`)
      expect(rows()).toContain(`Unmute ${noun}`)
    })

    it(`does not open a terminal on the desktop to learn the host is a ${noun}`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      render({ ...props, openHostId: null })
      await elapse(500)
      expect(host.created).toEqual([])
      render({ ...props, openHostId: host.hostId })
      expect(hook.latest?.macOptions?.hostPlatform).toBe(platform)
    })
  }

  // Until 2026-10-15 this pinned "draws nothing an earlier connection said", which drew
  // both rows of each pair on every first open (the user's screenshot that day). The
  // display and the sound are now remembered across connections; the lock never is.
  it('draws only the display and mute an earlier connection said once the host reconnected, never its lock', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    host.answer = UNLOCKED_AWAKE
    await openOnce(host, props)
    host.connectedAt = 2
    host.answer = null
    reopen(host, props)
    expect(hook.latest?.macOptions?.state).toEqual({ ...UNLOCKED_AWAKE_STATE, lock: 'unknown' })
  })

  // Unlock types the password into whatever is in front on the Mac, so it follows
  // only what the Mac said on this open (mac-host-sheet-actions.ts).
  it('does not offer Unlock on a second open until the Mac says again that it is locked', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    host.answer = LOCKED_MUTED
    await openOnce(host, props)
    host.answer = null
    reopen(host, props)
    expect(states).not.toContain('checking')
    expect(rows()).toContain('Lock Mac')
    expect(rows()).not.toContain('Unlock Mac')
    expect(rows()).toContain('Wake display')
    expect(rows()).toContain('Unmute Mac')
    host.answer = LOCKED_MUTED
    await elapse(400)
    expect(rows()).toContain('Unlock Mac')
    expect(rows()).not.toContain('Lock Mac')
  })
})

// 2026-10-14, the user, after 0.9.139: the first open of a host's menu on each
// connection still hid the Mac or PC rows behind "Checking…" until the host answered,
// and the sheet changed height when it did. Nothing about these rows needs the
// answer first: each is harmless on a host already in that state, except Unlock,
// which is never offered before the Mac says it is locked. Since 2026-10-15 the
// answer narrows the sheet to the rows that would do something (the user's call),
// so its height does change then. Every test here is a host with no history: since
// 2026-10-15 a first open draws the display and mute the host named on an earlier
// connection or app run, one row of each pair (the next describe block); both rows
// of a pair are left only for a host that never said.
describe('the host menu opened for the first time on a connection', () => {
  const FIRST_ROWS = {
    darwin: ['Lock Mac', 'Sleep display', 'Wake display', 'Mute Mac', 'Unmute Mac'],
    win32: ['Lock PC', 'Mute PC', 'Unmute PC']
  } as const

  function rowStates(): string[] {
    return getMacHostSheetActions(hook.latest?.macOptions).map((row) => `${row.label}${row.disabled ? ' (off)' : ''}`)
  }

  async function openFirst(host: FakeHost, props: MenuProps) {
    render({ ...props, openHostId: null })
    await elapse(10)
    states.length = 0
    render({ ...props, openHostId: host.hostId })
  }

  for (const { platform, noun, marker } of HOSTS) {
    it(`shows the ${noun} actions at once, enabled, before the ${noun} answers`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      await openFirst(host, props)
      await elapse(100)
      expect(states).not.toContain('checking')
      expect(rowStates()).toEqual(FIRST_ROWS[platform])
    })

    // 2026-10-15, the user: "when a display is awake, only show sleep display, and when
    // a display sleeps, show wake display. Also for mute and unmute." The rows the
    // answer rules out go, rather than stay dimmed to hold the sheet's height.
    it(`shows only the ${noun} rows that would do something once the ${noun} answers, none dimmed`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      await openFirst(host, props)
      host.answer = marker(true, 'on')
      await elapse(400)
      expect(rowStates()).toEqual(
        platform === 'win32' ? ['Lock PC', 'Unmute PC'] : ['Lock Mac', 'Sleep display', 'Unmute Mac']
      )
      expect(states).not.toContain('checking')
    })

    it(`keeps offering every ${noun} row when the first check never answers`, async () => {
      const host = fakeHost('host', platform)
      const props = propsFor(host)
      await openFirst(host, props)
      await elapse(20_000)
      expect(host.probes()).toBe(1)
      expect(states).not.toContain('checking')
      expect(rowStates()).toEqual(FIRST_ROWS[platform])
    })

    it(`keeps offering every ${noun} row when the host refuses the first check`, async () => {
      const host = fakeHost('host', platform)
      host.liveWorktree = 'elsewhere'
      const props = propsFor(host)
      await openFirst(host, props)
      await elapse(2000)
      expect(states).not.toContain('checking')
      expect(rowStates()).toEqual(FIRST_ROWS[platform])
    })

    it(`says why the ${noun} rows are off, with no spinner, when the host has no workspace`, async () => {
      const host = fakeHost('host', platform)
      const props = { clients: clientsOf(host), worktreeInfo: {} }
      await openFirst(host, props)
      await elapse(100)
      expect(states).not.toContain('checking')
      const sheet = getMacHostSheetActions(hook.latest?.macOptions)
      expect(sheet.map((row) => row.label)).toEqual(FIRST_ROWS[platform])
      expect(sheet.every((row) => row.disabled && !row.loading)).toBe(true)
      expect(host.created).toEqual([])
    })
  }

  it('swaps Lock for Unlock in place, never before the Mac says it is locked', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    await openFirst(host, props)
    await elapse(100)
    expect(rowStates()[0]).toBe('Lock Mac')
    expect(rowStates()).not.toContain('Unlock Mac')
    host.answer = LOCKED_MUTED
    await elapse(400)
    expect(rowStates()).toEqual(['Unlock Mac', 'Wake display', 'Unmute Mac'])
  })

  it('draws the narrower rows the host named on the next open', async () => {
    const host = fakeHost('host', 'darwin')
    const props = propsFor(host)
    await openFirst(host, props)
    host.answer = UNLOCKED_AWAKE
    await elapse(400)
    render({ ...props, openHostId: null })
    await elapse(10)
    reopen(host, props)
    expect(rowStates()).toEqual(['Lock Mac', 'Sleep display', 'Mute Mac'])
  })
})

// 2026-10-15, the user, with a screenshot of the Mac's menu: "Fix this too". It listed
// Lock Mac, Sleep display, Wake display, Mute Mac and Unmute Mac all at once, on the
// day they had asked for only the row of each pair that would do something. That was
// the first open on a connection: nothing was known yet, and an unknown state offers
// both halves of each pair. The display and the sound the host last named are now
// kept on the phone across connections and restarts (remembered-host-state-store.ts).
// The lock is never kept: Unlock still waits for this connection's own answer.
