import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { HostWorktreeInfo } from '../worktree/home-worktree-info'

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

import { MAC_HOST_STATE_PROBE_COMMAND, type MacHostState } from './mac-host-state'
import type { MacHostSheetState } from './mac-host-sheet-actions'
import { useMacHostControls } from './use-mac-host-controls'

type Props = Parameters<typeof useMacHostControls>[0]

function ok(result: unknown) {
  return { id: '1', ok: true as const, result, _meta: { runtimeId: 'r' } }
}

/** A host that answers like Orca: a tab per createTerminal in a workspace it still
 *  has, and a screen that shows the probe's marker once `answer` is set, or the done
 *  marker for an action. An action that has run leaves `afterAction` as the answer a second later. */
function fakeHost(hostId: string, platform: NodeJS.Platform) {
  const created: string[] = []
  const commandByTerminal = new Map<string, string>()
  const host = {
    hostId,
    answer: null as string | null,
    afterAction: null as string | null,
    liveWorktree: `${hostId}-wt`,
    created,
    client: {
      sendRequest: vi.fn(async (method: string, params?: unknown) => {
        const args = (params ?? {}) as { command?: string; terminal?: string; worktree?: string }
        if (method === 'host.platform') {
          return ok({ platform })
        }
        if (method === 'session.tabs.createTerminal') {
          if (args.worktree !== `id:${host.liveWorktree}`) {
            return { id: '1', ok: false as const, error: { code: 'not_found', message: 'worktree_not_found' } }
          }
          const terminal = `${hostId}-term-${created.length + 1}`
          created.push(args.command ?? '')
          commandByTerminal.set(terminal, args.command ?? '')
          return ok({ tab: { id: `${terminal}-tab`, type: 'terminal', terminal } })
        }
        if (method === 'terminal.read') {
          const command = commandByTerminal.get(args.terminal ?? '') ?? ''
          if (command === MAC_HOST_STATE_PROBE_COMMAND) {
            return ok({ terminal: { lines: host.answer ? [host.answer] : [] } })
          }
          // The host takes a moment to settle after the command says it is done:
          // a display sleeps about a second after pmset returns.
          const settled = host.afterAction
          if (settled) {
            host.afterAction = null
            setTimeout(() => {
              host.answer = settled
            }, 1000)
          }
          return ok({ terminal: { lines: ['CUIDONE ok'] } })
        }
        return ok({})
      })
    } as unknown as RpcClient,
    probes: () => created.filter((command) => command === MAC_HOST_STATE_PROBE_COMMAND).length
  }
  return host
}

function infoFor(hostId: string, worktreeId = `${hostId}-wt`): HostWorktreeInfo {
  return {
    hostId,
    totalWorktrees: 1,
    activeCount: 1,
    lastActiveWorktree: {
      worktreeId,
      repo: 'repo',
      branch: 'main',
      displayName: 'repo',
      liveTerminalCount: 0
    }
  }
}

const states: (MacHostSheetState | undefined)[] = []
let latest: ReturnType<typeof useMacHostControls> | null = null

function Harness(props: Props) {
  latest = useMacHostControls(props)
  states.push(latest.macOptions?.state)
  return null
}

let renderer: ReactTestRenderer | null = null

function render(props: Props) {
  act(() => {
    if (renderer) {
      renderer.update(createElement(Harness, props))
    } else {
      renderer = create(createElement(Harness, props))
    }
  })
}

async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const LOCKED_MUTED = 'CUIMAC lock=1 mute=true display=off end'
const UNLOCKED_AWAKE = 'CUIMAC lock=0 mute=false display=on end'
const LOCKED_MUTED_STATE: MacHostState = { lock: 'locked', display: 'off', mute: 'muted' }
const UNLOCKED_AWAKE_STATE: MacHostState = { lock: 'unlocked', display: 'on', mute: 'unmuted' }

beforeEach(() => {
  vi.useFakeTimers()
  states.length = 0
  latest = null
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

function clientsOf(...hosts: ReturnType<typeof fakeHost>[]): Props['clients'] {
  return hosts.map((host) => ({ hostId: host.hostId, client: host.client, state: 'connected' as const }))
}

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
    expect(latest?.macOptions?.state).toBe('checking')

    mac.answer = LOCKED_MUTED
    await elapse(400)
    expect(latest?.macOptions?.state).toEqual(LOCKED_MUTED_STATE)
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
    expect(latest?.macOptions?.state).toEqual(UNLOCKED_AWAKE_STATE)
    expect(mac.probes()).toBe(1)
  })

  it('never draws what an earlier open said before this open has its own answer', async () => {
    const mac = fakeHost('mac', 'darwin')
    const props = { clients: clientsOf(mac), worktreeInfo: { mac: infoFor('mac') } }
    render({ ...props, openHostId: null })
    await elapse(10)
    mac.answer = LOCKED_MUTED
    render({ ...props, openHostId: 'mac' })
    await elapse(400)
    expect(latest?.macOptions?.state).toEqual(LOCKED_MUTED_STATE)

    render({ ...props, openHostId: null })
    mac.answer = null
    states.length = 0
    render({ ...props, openHostId: 'mac' })
    await elapse(400)
    expect(states.filter((state) => state !== undefined && state !== 'checking')).toEqual([])
    mac.answer = UNLOCKED_AWAKE
    await elapse(400)
    expect(latest?.macOptions?.state).toEqual(UNLOCKED_AWAKE_STATE)
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
    const onAction = latest?.macOptions?.onAction
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
    const onAction = latest?.macOptions?.onAction
    render({ ...props, openHostId: null })
    mac.afterAction = 'CUIMAC lock=0 mute=false display=off end'
    act(() => onAction?.('sleep-display'))
    render({ ...props, openHostId: 'mac' })
    await elapse(100)
    // The display is still settling: the menu says it is checking, not the old rows.
    expect(latest?.macOptions?.state).toBe('checking')
    // Stepped: act flushes the settled state at the end of each step, and the probe it
    // starts needs timers of its own.
    await elapse(3500)
    await elapse(500)
    expect(latest?.macOptions?.state).toEqual({ lock: 'unlocked', display: 'off', mute: 'unmuted' })
    expect(mac.probes()).toBe(2)
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
    const onAction = latest?.macOptions?.onAction
    render({ ...props, openHostId: null })
    act(() => onAction?.('unmute'))
    await elapse(500)
    // The other Mac is slow to answer; its sheet must say it is still checking.
    render({ ...props, openHostId: 'other' })
    await elapse(5000)
    expect(latest?.macOptions?.state).toBe('checking')
    other.answer = UNLOCKED_AWAKE
    await elapse(400)
    expect(latest?.macOptions?.state).toEqual(UNLOCKED_AWAKE_STATE)
  })
})
