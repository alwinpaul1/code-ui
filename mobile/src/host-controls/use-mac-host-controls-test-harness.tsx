import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { HostWorktreeInfo } from '../worktree/home-worktree-info'
import type { MacHostAction } from './mac-host-commands'
import { MAC_HOST_STATE_PROBE_COMMAND, type MacHostState } from './mac-host-state'
import { getMacHostSheetActions, type MacHostSheetState } from './mac-host-sheet-actions'
import { WINDOWS_HOST_STATE_PROBE_COMMAND } from './windows-host-state'
import { useMacHostControls } from './use-mac-host-controls'

/**
 * The fake hosts and the mounted hook the host-menu cases drive, shared by
 * use-mac-host-controls.test.tsx and remembered-host-state.test.tsx. Separate from the
 * cases because the `vi.mock` factories must stay in each test file while nothing here
 * has to, and one file holding both was over `max-lines` (2026-10-15).
 */

export type Props = Parameters<typeof useMacHostControls>[0]

export function ok(result: unknown) {
  return { id: '1', ok: true as const, result, _meta: { runtimeId: 'r' } }
}

/** A host that answers like Orca: a tab per createTerminal in a workspace it still
 *  has, and a screen that shows the probe's marker once `answer` is set, or the done
 *  marker for an action. An action that has run leaves `afterAction` as the answer a second later. */
export function fakeHost(hostId: string, platform: NodeJS.Platform) {
  const created: string[] = []
  const commandByTerminal = new Map<string, string>()
  const createdAtByTerminal = new Map<string, number>()
  const host = {
    hostId,
    answer: null as string | null,
    afterAction: null as string | null,
    /** 'stuck' never prints the done marker; 'throw' answers the action's tab with
     *  nothing at all, which throws inside the watch. */
    actionMode: 'done' as 'done' | 'stuck' | 'throw',
    /** What an action's tab shows instead of the done marker, when set. */
    actionScreen: null as string[] | null,
    /** How long an action's tab takes to print its done marker, and how long after
     *  that `afterAction` becomes the host's answer. */
    actionDoneAfterMs: 0,
    afterActionLagMs: 1000,
    liveWorktree: `${hostId}-wt`,
    /** What the client says getLastConnectedAt is; a new value is a reconnect. */
    connectedAt: 1 as number | null,
    created,
    client: {
      getLastConnectedAt: () => host.connectedAt,
      sendRequest: vi.fn(async (method: string, params?: unknown) => {
        const args = (params ?? {}) as { command?: string; terminal?: string; worktree?: string }
        if (method === 'host.platform') {
          return ok({ platform })
        }
        if (method === 'session.tabs.createTerminal') {
          if (args.worktree !== `id:${host.liveWorktree}`) {
            return { id: '1', ok: false as const, error: { code: 'not_found', message: 'worktree_not_found' } }
          }
          if (host.actionMode === 'throw' && !isProbe(args.command)) {
            return undefined
          }
          const terminal = `${hostId}-term-${created.length + 1}`
          created.push(args.command ?? '')
          commandByTerminal.set(terminal, args.command ?? '')
          createdAtByTerminal.set(terminal, Date.now())
          return ok({ tab: { id: `${terminal}-tab`, type: 'terminal', terminal } })
        }
        if (method === 'terminal.read') {
          const command = commandByTerminal.get(args.terminal ?? '') ?? ''
          if (isProbe(command)) {
            return ok({ terminal: { lines: host.answer ? [host.answer] : [] } })
          }
          const createdAt = createdAtByTerminal.get(args.terminal ?? '') ?? 0
          if (host.actionMode === 'stuck' || Date.now() < createdAt + host.actionDoneAfterMs) {
            return ok({ terminal: { lines: [] } })
          }
          if (host.actionScreen) {
            return ok({ terminal: { lines: [command, ...host.actionScreen] } })
          }
          // The host takes a moment to settle after the command says it is done:
          // a display sleeps about a second after pmset returns.
          const settled = host.afterAction
          if (settled) {
            host.afterAction = null
            setTimeout(() => {
              host.answer = settled
            }, host.afterActionLagMs)
          }
          return ok({ terminal: { lines: ['CUIDONE ok'] } })
        }
        return ok({})
      })
    } as unknown as RpcClient,
    probes: () => created.filter(isProbe).length
  }
  return host
}

export function isProbe(command: string | undefined): boolean {
  return command === MAC_HOST_STATE_PROBE_COMMAND || command === WINDOWS_HOST_STATE_PROBE_COMMAND
}

export function infoFor(hostId: string, worktreeId = `${hostId}-wt`): HostWorktreeInfo {
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

export const states: (MacHostSheetState | undefined)[] = []
/** What the hook returned on its last render. A record rather than a module `let`, so
 *  the render below writes a property and reassigns nothing outside the component. */
export const hook: { latest: ReturnType<typeof useMacHostControls> | null } = { latest: null }

export function Harness(props: Props) {
  const controls = useMacHostControls(props)
  hook.latest = controls
  states.push(controls.macOptions?.state)
  return null
}

let renderer: ReactTestRenderer | null = null

export function render(props: Props) {
  act(() => {
    if (renderer) {
      renderer.update(createElement(Harness, props))
    } else {
      renderer = create(createElement(Harness, props))
    }
  })
}

export async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Steps time in tenths of a second, so each step's state change renders before the
 *  next, and says how long the menu said "Checking", or null past the limit. */
export async function checkingFor(limitMs: number): Promise<number | null> {
  for (let waited = 0; waited <= limitMs; waited += 100) {
    if (hook.latest?.macOptions?.state !== 'checking') {
      return waited
    }
    await elapse(100)
  }
  return null
}

export const LOCKED_MUTED = 'CUIMAC lock=1 mute=true display=off end'
export const UNLOCKED_AWAKE = 'CUIMAC lock=0 mute=false display=on end'
export const LOCKED_MUTED_STATE: MacHostState = { lock: 'locked', display: 'off', mute: 'muted' }
export const UNLOCKED_AWAKE_STATE: MacHostState = { lock: 'unlocked', display: 'on', mute: 'unmuted' }

/** Before each case: no renders recorded, nothing mounted. */
export function resetHarness() {
  states.length = 0
  hook.latest = null
}

/** Unmounts the hook, as the app being killed does: nothing in memory survives. */
export function unmountHarness() {
  act(() => renderer?.unmount())
  renderer = null
  hook.latest = null
}

export function clientsOf(...hosts: ReturnType<typeof fakeHost>[]): Props['clients'] {
  return hosts.map((host) => ({ hostId: host.hostId, client: host.client, state: 'connected' as const }))
}

export const HOSTS = [
  {
    platform: 'darwin',
    noun: 'Mac',
    marker: (mute: boolean, display: 'on' | 'off') => `CUIMAC lock=0 mute=${mute} display=${display} end`
  },
  {
    platform: 'win32',
    noun: 'PC',
    // A PC reports no display (Sleep display was removed from Windows, 2026-10-10).
    marker: (mute: boolean, _display: 'on' | 'off') => `CUIWIN mute=${mute} end`
  }
] as const

export type FakeHost = ReturnType<typeof fakeHost>
export type MenuProps = Omit<Props, 'openHostId'>

/** The rows a tap acts on: rows off for want of a workspace are left out. */
export function rows(): string[] {
  return getMacHostSheetActions(hook.latest?.macOptions)
    .filter((row) => !row.disabled)
    .map((row) => row.label)
}

export function propsFor(host: FakeHost): MenuProps {
  return { clients: clientsOf(host), worktreeInfo: { [host.hostId]: infoFor(host.hostId) } }
}

/** Opens the host's menu, lets the host answer, closes it and runs `action` from it. */
export async function runFromMenu(host: FakeHost, props: MenuProps, action: MacHostAction) {
  render({ ...props, openHostId: null })
  await elapse(10)
  render({ ...props, openHostId: host.hostId })
  await elapse(600)
  expect(hook.latest?.macOptions?.state).not.toBe('checking')
  const onAction = hook.latest?.macOptions?.onAction
  render({ ...props, openHostId: null })
  act(() => onAction?.(action))
  await elapse(600)
}

export function reopen(host: FakeHost, props: MenuProps) {
  states.length = 0
  render({ ...props, openHostId: host.hostId })
}
