import { describe, expect, it, vi } from 'vitest'
import { getHostListActionSheetActions } from './host-list-action-sheet-actions'
import { UNKNOWN_MAC_HOST_STATE, type MacHostState } from './host-controls/mac-host-state'
import type { ConnectionState, HostProfile } from './transport/types'

vi.mock('lucide-react-native', () => ({
  Activity: vi.fn(),
  Edit3: vi.fn(),
  Lock: vi.fn(),
  LockOpen: vi.fn(),
  MonitorOff: vi.fn(),
  PowerOff: vi.fn(),
  RefreshCw: vi.fn(),
  Sunrise: vi.fn()
}))

const HOST: HostProfile = {
  id: 'host-1',
  name: 'Host 1',
  endpoint: 'ws://192.168.21.4:6768',
  deviceToken: 'token',
  publicKeyB64: 'key',
  lastConnected: 0
}

function build(overrides: { state?: ConnectionState; hasEverConnected?: boolean } = {}) {
  const spies = {
    onDismiss: vi.fn(),
    onReconnect: vi.fn(),
    onDisconnect: vi.fn(),
    onDiagnostics: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn()
  }
  const actions = getHostListActionSheetActions({
    host: HOST,
    state: overrides.state ?? 'connected',
    hasEverConnected: overrides.hasEverConnected ?? true,
    ...spies
  })
  return { actions, spies }
}

describe('getHostListActionSheetActions', () => {
  // Why: these navigate or open a second drawer. Presenting while this sheet's native
  // Modal is still up freezes the whole screen on iOS — issue #8791.
  it.each(['Network diagnostics', 'Edit host', 'Remove'])(
    'defers %s until the action sheet has closed',
    (label) => {
      const { actions } = build()
      expect(actions.find((action) => action.label === label)).toMatchObject({
        closeBeforePress: true
      })
    }
  )

  it('leaves the in-place actions undeferred so they fire on tap', () => {
    const { actions, spies } = build()
    const disconnect = actions.find((action) => action.label === 'Disconnect')
    expect(disconnect?.closeBeforePress).toBeUndefined()
    disconnect?.onPress()
    expect(spies.onDisconnect).toHaveBeenCalledWith(HOST.id)
    expect(spies.onDismiss).toHaveBeenCalled()
  })

  it('hands Remove the whole host so the confirm sheet can name it', () => {
    const { actions, spies } = build()
    actions.find((action) => action.label === 'Remove')?.onPress()
    expect(spies.onRemove).toHaveBeenCalledWith(HOST)
  })

  it('routes Edit host to the edit screen', () => {
    const { actions, spies } = build()
    actions.find((action) => action.label === 'Edit host')?.onPress()
    expect(spies.onEdit).toHaveBeenCalledWith(HOST.id)
  })

  it('routes Network diagnostics with the selected host', () => {
    const { actions, spies } = build()
    actions.find((action) => action.label === 'Network diagnostics')?.onPress()
    expect(spies.onDiagnostics).toHaveBeenCalledWith(HOST.id)
  })

  it('offers Disconnect only while the socket is live', () => {
    expect(build({ state: 'reconnecting' }).actions.map((action) => action.label)).toEqual([
      'Reconnect',
      'Disconnect',
      'Network diagnostics',
      'Edit host',
      'Remove'
    ])
    expect(build({ state: 'disconnected' }).actions.map((action) => action.label)).toEqual([
      'Connect',
      'Network diagnostics',
      'Edit host',
      'Remove'
    ])
  })

  it('says Connect until the host has connected at least once this session', () => {
    expect(build({ hasEverConnected: false }).actions[0]?.label).toBe('Connect')
    expect(build({ hasEverConnected: true }).actions[0]?.label).toBe('Reconnect')
  })

  it('renders nothing without a target host', () => {
    expect(
      getHostListActionSheetActions({
        host: null,
        state: 'disconnected',
        hasEverConnected: false,
        onDismiss: vi.fn(),
        onReconnect: vi.fn(),
        onDisconnect: vi.fn(),
        onDiagnostics: vi.fn(),
        onEdit: vi.fn(),
        onRemove: vi.fn()
      })
    ).toEqual([])
  })
})

const MAC_LABELS = ['Lock Mac', 'Unlock Mac', 'Sleep display', 'Wake display']

function macLabelsOf(actions: { label: string }[]): string[] {
  return actions.map((action) => action.label).filter((label) => MAC_LABELS.includes(label))
}

function buildWithMac(mac: {
  hostPlatform: NodeJS.Platform | null
  worktreeId?: string | null
  state?: MacHostState | 'checking'
}) {
  const onMacAction = vi.fn()
  const actions = getHostListActionSheetActions({
    host: HOST,
    state: 'connected',
    hasEverConnected: true,
    onDismiss: vi.fn(),
    onReconnect: vi.fn(),
    onDisconnect: vi.fn(),
    onDiagnostics: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    mac: {
      hostPlatform: mac.hostPlatform,
      worktreeId: mac.worktreeId === undefined ? 'wt-1' : mac.worktreeId,
      state: mac.state ?? UNKNOWN_MAC_HOST_STATE,
      onAction: onMacAction
    }
  })
  return { actions, onMacAction }
}

describe('the Mac controls on the host sheet', () => {
  it('offers lock, unlock, sleep and wake on a Mac', () => {
    const { actions } = buildWithMac({ hostPlatform: 'darwin' })
    expect(actions.map((action) => action.label)).toEqual([
      'Reconnect',
      'Disconnect',
      ...MAC_LABELS,
      'Network diagnostics',
      'Edit host',
      'Remove'
    ])
  })

  it.each(['win32', 'linux'] as const)('shows a %s user nothing about a Mac', (hostPlatform) => {
    const labels = buildWithMac({ hostPlatform }).actions.map((action) => action.label)
    for (const label of MAC_LABELS) {
      expect(labels).not.toContain(label)
    }
  })

  it('stays quiet until the host has said which platform it is', () => {
    const labels = buildWithMac({ hostPlatform: null }).actions.map((action) => action.label)
    expect(labels).not.toContain('Lock Mac')
  })

  it('heads the group so the rows below it read as host actions again', () => {
    const { actions } = buildWithMac({ hostPlatform: 'darwin' })
    expect(actions.find((action) => action.label === 'Lock Mac')?.group).toBe('Mac')
    expect(actions.find((action) => action.label === 'Network diagnostics')?.group).toBe('Host')
    expect(actions.find((action) => action.label === 'Reconnect')?.group).toBeUndefined()
  })

  it('leaves the sheet ungrouped when there are no Mac rows to separate', () => {
    const { actions } = buildWithMac({ hostPlatform: 'win32' })
    expect(actions.every((action) => action.group === undefined)).toBe(true)
  })

  it('says why it cannot act when the Mac has no workspace to run in', () => {
    const { actions, onMacAction } = buildWithMac({ hostPlatform: 'darwin', worktreeId: null })
    const lock = actions.find((action) => action.label === 'Lock Mac')
    expect(lock?.disabled).toBe(true)
    expect(lock?.hint).toBe('Open a workspace on this Mac first')
    lock?.onPress()
    expect(onMacAction).not.toHaveBeenCalled()
  })

  it('offers only Lock and Sleep to an awake, unlocked Mac', () => {
    const { actions } = buildWithMac({
      hostPlatform: 'darwin',
      state: { lock: 'unlocked', display: 'on' }
    })
    expect(macLabelsOf(actions)).toEqual(['Lock Mac', 'Sleep display'])
  })

  it('offers only Unlock and Wake to a locked Mac with its display off', () => {
    const { actions } = buildWithMac({
      hostPlatform: 'darwin',
      state: { lock: 'locked', display: 'off' }
    })
    expect(macLabelsOf(actions)).toEqual(['Unlock Mac', 'Wake display'])
  })

  it('offers Unlock and Sleep to a locked Mac whose display is still on', () => {
    const { actions } = buildWithMac({
      hostPlatform: 'darwin',
      state: { lock: 'locked', display: 'on' }
    })
    expect(macLabelsOf(actions)).toEqual(['Unlock Mac', 'Sleep display'])
  })

  it('offers Lock and Wake to an unlocked Mac whose display has gone dark', () => {
    const { actions } = buildWithMac({
      hostPlatform: 'darwin',
      state: { lock: 'unlocked', display: 'off' }
    })
    expect(macLabelsOf(actions)).toEqual(['Lock Mac', 'Wake display'])
  })

  it('falls back to all four when the Mac would not say what state it is in', () => {
    const { actions } = buildWithMac({ hostPlatform: 'darwin', state: UNKNOWN_MAC_HOST_STATE })
    expect(macLabelsOf(actions)).toEqual(MAC_LABELS)
  })

  it('offers the half it does know when only one answer came back', () => {
    expect(
      macLabelsOf(
        buildWithMac({ hostPlatform: 'darwin', state: { lock: 'locked', display: 'unknown' } })
          .actions
      )
    ).toEqual(['Unlock Mac', 'Sleep display', 'Wake display'])
  })

  it('says it is checking, and offers nothing to tap, until the Mac answers', () => {
    const { actions, onMacAction } = buildWithMac({ hostPlatform: 'darwin', state: 'checking' })
    const labels = actions.map((action) => action.label)
    expect(labels).toContain('Checking the Mac…')
    for (const label of MAC_LABELS) {
      expect(labels).not.toContain(label)
    }
    const checking = actions.find((action) => action.label === 'Checking the Mac…')
    expect(checking?.disabled).toBe(true)
    expect(checking?.loading).toBe(true)
    expect(checking?.group).toBe('Mac')
    checking?.onPress()
    expect(onMacAction).not.toHaveBeenCalled()
  })

  it('waits for the sheet to close before Unlock can raise the password drawer', () => {
    const { actions } = buildWithMac({ hostPlatform: 'darwin' })
    for (const label of MAC_LABELS) {
      expect(actions.find((action) => action.label === label)?.closeBeforePress).toBe(true)
    }
  })

  it('hands each tap its own action', () => {
    const { actions, onMacAction } = buildWithMac({ hostPlatform: 'darwin' })
    for (const [label, action] of [
      ['Lock Mac', 'lock'],
      ['Unlock Mac', 'unlock'],
      ['Sleep display', 'sleep-display'],
      ['Wake display', 'wake-display']
    ] as const) {
      onMacAction.mockClear()
      actions.find((entry) => entry.label === label)?.onPress()
      expect(onMacAction).toHaveBeenCalledWith(action)
    }
  })
})
