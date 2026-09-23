import { describe, expect, it, vi } from 'vitest'
import { getHostListActionSheetActions } from './host-list-action-sheet-actions'
import { UNKNOWN_MAC_HOST_STATE, type MacHostState } from './host-controls/mac-host-state'
import { macHostSheetState } from './host-controls/mac-host-sheet-actions'
import type { ConnectionState, HostProfile } from './transport/types'

vi.mock('lucide-react-native', () => ({
  Activity: vi.fn(),
  Edit3: vi.fn(),
  Lock: vi.fn(),
  LockOpen: vi.fn(),
  MonitorOff: vi.fn(),
  PowerOff: vi.fn(),
  RefreshCw: vi.fn(),
  Sunrise: vi.fn(),
  Unplug: vi.fn(),
  Volume2: vi.fn(),
  VolumeX: vi.fn()
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

const MAC_LABELS = ['Lock Mac', 'Unlock Mac', 'Sleep display', 'Wake display', 'Mute Mac', 'Unmute Mac']

function macLabelsOf(actions: { label: string }[]): string[] {
  return actions.map((action) => action.label).filter((label) => MAC_LABELS.includes(label))
}

function buildWithMac(mac: {
  hostPlatform: NodeJS.Platform | null
  worktreeId?: string | null
  state?: MacHostState | 'checking' | 'offline' | 'connecting'
  onForgetUnlockPassword?: () => void
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
      onAction: onMacAction,
      onForgetUnlockPassword: mac.onForgetUnlockPassword
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
    // The display rows are the same words on both hosts; these are the Mac's own.
    for (const label of MAC_LABELS.filter((macLabel) => macLabel.includes('Mac'))) {
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

  it('leaves the sheet ungrouped when there are no host-control rows to separate', () => {
    const { actions } = buildWithMac({ hostPlatform: 'linux' })
    expect(actions.every((action) => action.group === undefined)).toBe(true)
  })

  describe('on a Windows PC', () => {
    const labelsFor = (state: MacHostState) =>
      buildWithMac({ hostPlatform: 'win32', state }).actions.map((action) => action.label)

    it('offers lock, both display rows and the mute that applies, under its own group', () => {
      const { actions } = buildWithMac({
        hostPlatform: 'win32',
        state: { lock: 'unlocked', display: 'unknown', mute: 'unmuted' }
      })
      expect(actions.map((action) => action.label)).toEqual([
        'Reconnect',
        'Disconnect',
        'Lock PC',
        'Sleep display',
        'Wake display',
        'Mute PC',
        'Network diagnostics',
        'Edit host',
        'Remove'
      ])
      expect(actions.find((action) => action.label === 'Lock PC')?.group).toBe('Windows')
    })

    it('never offers Unlock, and says why when the PC is locked', () => {
      const labels = labelsFor({ lock: 'locked', display: 'unknown', mute: 'muted' })
      expect(labels.some((label) => /unlock/i.test(label) && label !== 'Locked · unlock at the PC')).toBe(false)
      expect(labels).toContain('Locked · unlock at the PC')
      expect(labels).toContain('Unmute PC')
      const { actions, onMacAction } = buildWithMac({
        hostPlatform: 'win32',
        state: { lock: 'locked', display: 'unknown', mute: 'muted' }
      })
      const note = actions.find((action) => action.label === 'Locked · unlock at the PC')
      expect(note?.disabled).toBe(true)
      expect(note?.group).toBe('Windows')
      note?.onPress()
      expect(onMacAction).not.toHaveBeenCalled()
    })

    it('offers Lock when the PC would not say whether it is locked', () => {
      const labels = labelsFor({ lock: 'unknown', display: 'unknown', mute: 'unknown' })
      expect(labels).toEqual(expect.arrayContaining(['Lock PC', 'Mute PC', 'Unmute PC']))
      expect(labels).not.toContain('Locked · unlock at the PC')
    })

    it('says why it cannot act when the PC has no workspace to run in', () => {
      const { actions, onMacAction } = buildWithMac({ hostPlatform: 'win32', worktreeId: null })
      const lock = actions.find((action) => action.label === 'Lock PC')
      expect(lock?.disabled).toBe(true)
      expect(lock?.hint).toBe('Open a workspace on this PC first')
      lock?.onPress()
      expect(onMacAction).not.toHaveBeenCalled()
    })

    // 2026-09-23, from the phone: an offline PC offered all five rows, and
    // Wake display then said "The Mac did not answer."
    it('offers no PC action while the PC is offline, and says so, instead of rows that can only fail', () => {
      const { actions, onMacAction } = buildWithMac({ hostPlatform: 'win32', state: 'offline' })
      const windows = actions.filter((action) => action.group === 'Windows' || /PC|display/.test(action.label))
      expect(windows.map((action) => action.label)).toEqual(['PC offline · connect first'])
      expect(windows[0]).toMatchObject({ disabled: true, group: 'Windows' })
      windows[0]?.onPress()
      expect(onMacAction).not.toHaveBeenCalled()
    })

    it('offers only the display row that applies once the PC says whether its display is on', () => {
      const on = labelsFor({ lock: 'unlocked', display: 'on', mute: 'unmuted' })
      expect(on).toContain('Sleep display')
      expect(on).not.toContain('Wake display')
      const off = labelsFor({ lock: 'unlocked', display: 'off', mute: 'muted' })
      expect(off).toContain('Wake display')
      expect(off).not.toContain('Sleep display')
      expect(off).toContain('Unmute PC')
      expect(off).not.toContain('Mute PC')
    })

    it('shows one checking row while the PC is asked', () => {
      const { actions } = buildWithMac({ hostPlatform: 'win32', state: 'checking' })
      const checking = actions.find((action) => action.label === 'Checking the PC…')
      expect(checking?.loading).toBe(true)
      expect(checking?.group).toBe('Windows')
    })
  })

  it('offers no Mac action while the Mac is offline', () => {
    const { actions } = buildWithMac({ hostPlatform: 'darwin', state: 'offline' })
    const mac = actions.filter((action) => action.group === 'Mac' || /Mac|display/.test(action.label))
    expect(mac.map((action) => action.label)).toEqual(['Mac offline · connect first'])
  })

  it('reads a host that is not connected as offline or connecting, whatever an earlier probe said', () => {
    const probed: MacHostState = { lock: 'unlocked', display: 'on', mute: 'unmuted' }
    for (const connection of ['disconnected', 'auth-failed', undefined] as const) {
      expect(macHostSheetState(connection, probed)).toBe('offline')
    }
    for (const connection of ['reconnecting', 'connecting', 'handshaking'] as const) {
      expect(macHostSheetState(connection, probed)).toBe('connecting')
    }
    expect(macHostSheetState('connected', probed)).toBe(probed)
    expect(macHostSheetState('connected', 'checking')).toBe('checking')
  })

  it('says it is waiting, not "offline · connect first", while the host is already connecting', () => {
    const { actions } = buildWithMac({ hostPlatform: 'win32', state: 'connecting' })
    const waiting = actions.filter((action) => action.group === 'Windows')
    expect(waiting.map((action) => action.label)).toEqual(['Waiting for the PC to connect…'])
    expect(waiting[0]).toMatchObject({ disabled: true, loading: true })
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
      state: { lock: 'unlocked', display: 'on', mute: 'unmuted' }
    })
    expect(macLabelsOf(actions)).toEqual(['Lock Mac', 'Sleep display', 'Mute Mac'])
  })

  it('offers only Unlock and Wake to a locked Mac with its display off', () => {
    const { actions } = buildWithMac({
      hostPlatform: 'darwin',
      state: { lock: 'locked', display: 'off', mute: 'muted' }
    })
    expect(macLabelsOf(actions)).toEqual(['Unlock Mac', 'Wake display', 'Unmute Mac'])
  })

  it('offers Unlock and Sleep to a locked Mac whose display is still on', () => {
    const { actions } = buildWithMac({
      hostPlatform: 'darwin',
      state: { lock: 'locked', display: 'on', mute: 'unmuted' }
    })
    expect(macLabelsOf(actions)).toEqual(['Unlock Mac', 'Sleep display', 'Mute Mac'])
  })

  it('offers Lock and Wake to an unlocked Mac whose display has gone dark', () => {
    const { actions } = buildWithMac({
      hostPlatform: 'darwin',
      state: { lock: 'unlocked', display: 'off', mute: 'muted' }
    })
    expect(macLabelsOf(actions)).toEqual(['Lock Mac', 'Wake display', 'Unmute Mac'])
  })

  it('falls back to every row when the Mac would not say what state it is in', () => {
    const { actions } = buildWithMac({ hostPlatform: 'darwin', state: UNKNOWN_MAC_HOST_STATE })
    expect(macLabelsOf(actions)).toEqual(MAC_LABELS)
  })

  it('offers the half it does know when only one answer came back', () => {
    expect(
      macLabelsOf(
        buildWithMac({ hostPlatform: 'darwin', state: { lock: 'locked', display: 'unknown', mute: 'muted' } })
          .actions
      )
    ).toEqual(['Unlock Mac', 'Sleep display', 'Wake display', 'Unmute Mac'])
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

  it('forgets the saved password when Unlock Mac is held, and does not unlock', () => {
    const onForget = vi.fn()
    const { actions, onMacAction } = buildWithMac({
      hostPlatform: 'darwin',
      state: { lock: 'locked', display: 'on', mute: 'unmuted' },
      onForgetUnlockPassword: onForget
    })
    const unlock = actions.find((action) => action.label === 'Unlock Mac')
    const sleep = actions.find((action) => action.label === 'Sleep display')
    expect(unlock?.onLongPress).toEqual(expect.any(Function))
    expect(unlock?.hint).toBeUndefined()
    expect(sleep?.onLongPress).toBeUndefined()
    unlock?.onLongPress?.()
    expect(onForget).toHaveBeenCalledOnce()
    expect(onMacAction).not.toHaveBeenCalled()
  })

  it('hands each tap its own action', () => {
    const { actions, onMacAction } = buildWithMac({ hostPlatform: 'darwin' })
    for (const [label, action] of [
      ['Lock Mac', 'lock'],
      ['Unlock Mac', 'unlock'],
      ['Sleep display', 'sleep-display'],
      ['Wake display', 'wake-display'],
      ['Mute Mac', 'mute'],
      ['Unmute Mac', 'unmute']
    ] as const) {
      onMacAction.mockClear()
      actions.find((entry) => entry.label === label)?.onPress()
      expect(onMacAction).toHaveBeenCalledWith(action)
    }
  })
})
