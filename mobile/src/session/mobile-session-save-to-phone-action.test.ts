import { describe, expect, it, vi } from 'vitest'

const device = vi.hoisted(() => ({
  supported: true,
  save: vi.fn(async () => ({ status: 'saved' }))
}))

vi.mock('lucide-react-native', () => ({ Download: 'Download' }))
// The device half opens Android's picker through expo-intent-launcher, which has no Node entry.
vi.mock('../files/mobile-file-save-device', () => ({
  get isSaveToPhoneSupported() {
    return device.supported
  },
  saveDesktopFileToPhoneOnDevice: device.save
}))

import { saveToPhoneSheetActions } from './mobile-session-save-to-phone-action'
import type { MobileSessionTab } from './mobile-session-route-types'
import type { Terminal } from './mobile-session-route-types'

const fileTab: Extract<MobileSessionTab, { type: 'file' }> = {
  type: 'file',
  id: 'tab-file',
  title: 'app.ts',
  filePath: '/Users/me/project/src/app.ts',
  relativePath: 'src/app.ts',
  isDirty: false,
  isActive: true
}

const markdownTab: Extract<MobileSessionTab, { type: 'markdown' }> = {
  type: 'markdown',
  id: 'tab-md',
  title: 'PLAN.md',
  filePath: '/Users/me/project/PLAN.md',
  relativePath: 'PLAN.md',
  isDirty: true,
  isActive: false,
  documentVersion: 'v1'
}

const terminals: Terminal[] = [
  { handle: 'term-parked', title: 'old', isActive: false, connected: false },
  { handle: 'term-other', title: 'build', isActive: false },
  { handle: 'term-active', title: 'claude', isActive: true }
]

const client = { sendRequest: vi.fn() }

function actionsFor(
  tab: MobileSessionTab | null,
  overrides: { client?: typeof client | null } = {}
) {
  const dismiss = vi.fn()
  const notify = vi.fn()
  const session = {
    client: overrides.client === undefined ? client : overrides.client,
    worktreeId: 'wt-1',
    terminals,
    showToast: notify
  }
  const actions = saveToPhoneSheetActions(session, tab as never, dismiss)
  return { actions, dismiss, notify }
}

describe("Save to Phone in a file tab's own menu", () => {
  it('is offered on a file tab and saves that tab’s file from its worktree', () => {
    device.save.mockClear()
    const { actions, dismiss, notify } = actionsFor(fileTab)

    expect(actions.map((action) => action.label)).toEqual(['Save to Phone'])
    actions[0]!.onPress()

    expect(dismiss).toHaveBeenCalled()
    expect(device.save).toHaveBeenCalledWith({
      client,
      source: {
        source: 'fileTab',
        worktreeId: 'wt-1',
        path: 'src/app.ts',
        terminalHandles: ['term-active', 'term-other']
      },
      notify
    })
  })

  it('says on a markdown tab that it saves the desktop copy, not the phone draft', () => {
    const { actions } = actionsFor(markdownTab)

    expect(actions[0]).toMatchObject({
      label: 'Save to Phone',
      hint: 'The file as saved on the desktop'
    })
  })

  it('falls back to the absolute path a tab carries when it has no relative one', () => {
    device.save.mockClear()
    const { actions } = actionsFor({ ...fileTab, relativePath: '', filePath: '/tmp/out.csv' })

    actions[0]!.onPress()

    expect(device.save).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.objectContaining({ path: '/tmp/out.csv' }) })
    )
  })

  it('says it is waiting instead of doing nothing when the desktop is not connected', () => {
    device.save.mockClear()
    const { actions, notify } = actionsFor(fileTab, { client: null })

    actions[0]!.onPress()

    expect(device.save).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('Waiting for desktop…', expect.any(Number))
  })

  it('offers nothing while no tab is targeted', () => {
    expect(actionsFor(null).actions).toEqual([])
  })

  it('offers nothing where the phone has no save picker', () => {
    device.supported = false
    try {
      expect(actionsFor(fileTab).actions).toEqual([])
    } finally {
      device.supported = true
    }
  })
})
