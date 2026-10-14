import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The header menu's session entries (parity gap G35) wired through the session sheets: Copy branch
 * and Copy session ID reach the clipboard and say so, Background tasks opens the chat's own sheet,
 * and Rename asks for a name in the Claude app's words and writes it with `worktree.set`.
 */

type MenuProps = {
  visible: boolean
  sessionEntries?: readonly string[]
  connection?: { text: string; connected: boolean }
  onCopyBranch?: () => void
  onOpenBackgroundTasks?: () => void
  onChangeModel?: () => void
  onRename?: () => void
  onArchive?: () => void
  onCopySessionId?: () => void
  onCheckSessionImages?: () => void
}
type ConfirmProps = {
  visible: boolean
  title: string
  message?: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}
type InputProps = {
  visible: boolean
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  submitLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}
const captured = vi.hoisted(() => ({
  menu: [] as MenuProps[],
  inputs: [] as InputProps[][],
  checks: [] as { visible: boolean; onClose: () => void }[],
  confirms: [] as ConfirmProps[]
}))
const hosts = vi.hoisted(() => ({ list: [] as { id: string; name: string; endpoint: string }[] }))
const clipboard = vi.hoisted(() => ({ writeText: vi.fn(async (_value: string) => {}) }))

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => clipboard }))
vi.mock('../platform/haptics', () => ({ triggerSuccess: () => {}, triggerError: () => {} }))
vi.mock('./MobileSessionHeaderMoreActionsSheet', () => ({
  MobileSessionHeaderMoreActionsSheet: (props: MenuProps) => {
    captured.menu.push(props)
    return null
  }
}))
vi.mock('./MobileCcrImagesSelfTest', () => ({
  MobileCcrImagesSelfTest: (props: { visible: boolean; onClose: () => void }) => {
    captured.checks.push(props)
    return null
  }
}))
vi.mock('../components/TextInputModal', () => ({
  TextInputModal: (props: InputProps) => {
    const frame = captured.inputs.at(-1)
    if (frame) {
      frame.push(props)
    }
    return null
  }
}))
vi.mock('./QuickCommandsSheet', () => ({ QuickCommandsSheet: () => null }))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: () => null }))
vi.mock('../components/ConfirmModal', () => ({
  ConfirmModal: (props: ConfirmProps) => {
    captured.confirms.push(props)
    return null
  }
}))
vi.mock('../transport/host-store', () => ({ loadHosts: async () => hosts.list }))
vi.mock('../components/CustomKeyModal', () => ({ CustomKeyModal: () => null }))
vi.mock('../components/MobileDictationSetupSheet', () => ({ MobileDictationSetupSheet: () => null }))
vi.mock('./MobileBrowserTabActionSheet', () => ({ MobileBrowserTabActionSheet: () => null }))
vi.mock('./mobile-terminal-action-sheet-actions', () => ({ getMobileTerminalActionSheetActions: () => [] }))
vi.mock('./mobile-session-save-to-phone-action', () => ({ saveToPhoneSheetActions: () => [] }))

import { MobileSessionSheets } from './MobileSessionSheets'
import { useBridgeBackgroundTasksToHeader } from './session-header-tasks-bridge'
import type { MobileSessionController } from './use-mobile-session-controller'

let renderers: ReactTestRenderer[] = []
afterEach(() => {
  act(() => renderers.forEach((renderer) => renderer.unmount()))
  renderers = []
  captured.menu.length = 0
  captured.inputs.length = 0
  captured.checks.length = 0
  captured.confirms.length = 0
  hosts.list = []
  clipboard.writeText.mockClear()
})

const ok = { id: 'set', ok: true, result: { worktree: {} }, _meta: { runtimeId: 'r' } }

const agentTab = {
  type: 'terminal',
  id: 't1',
  title: 'claude',
  terminal: 'h1',
  isActive: true,
  launchAgent: 'claude'
}
const shellTab = { ...agentTab, id: 't2', title: 'zsh', launchAgent: undefined }

function controller(
  showToast: (message: string) => void,
  sendRequest: (...args: unknown[]) => Promise<unknown> = vi.fn(async () => ok),
  over: Record<string, unknown> = {},
  chat: Record<string, unknown> = {}
) {
  const noop = () => {}
  return {
    hostId: 'host-1',
    connState: 'connected',
    connectionVerdict: { kind: 'normal', label: 'Connected' },
    visibleTabs: [agentTab, shellTab],
    activeSessionTabId: 't1',
    handleCloseSessionTab: vi.fn(),
    worktreeId: 'repo-1::/work/header',
    isFolderWorkspaceRoute: false,
    isFloatingWorkspaceRoute: false,
    client: { sendRequest },
    worktreeName: 'Header parity',
    worktreeBranch: 'refs/heads/feature/header',
    sessionTabs: [],
    showHeaderMoreActions: true,
    setShowHeaderMoreActions: noop,
    setShowCreateTabDrawer: noop,
    setShowQuickCommands: noop,
    setShowCreateBrowserModal: noop,
    setActionTarget: noop,
    setMarkdownActionTarget: noop,
    setFileActionTarget: noop,
    setBrowserActionTarget: noop,
    setAgentSessionActionTarget: noop,
    setDiscardMarkdownTarget: noop,
    setLeaveDrafts: noop,
    setRenameTarget: noop,
    setCustomKeys: noop,
    setShowCustomKeyModal: noop,
    setDeleteKeyTarget: noop,
    setShowDictationSetup: noop,
    setPendingDiffNotesDelivery: noop,
    terminalModes: new Map(),
    showToast,
    createTabAgentActions: [],
    sendDiffNotesAgentActions: [],
    bulkCloseActions: [],
    closeWithBulkActions: () => [],
    nativeChatController: {
      activeChatEligible: true,
      showNativeChat: true,
      isTabChatView: () => true,
      requestModelSheet: vi.fn(),
      nativeChatSessionOptions: { controller: { snapshot: [{ id: 'model', category: 'model' }] } },
      nativeChatSessionIdentity: { sessionId: '7f3c2b1a-0000-4000-8000-000000000000', transcriptPath: null, nestedSessionId: null },
      ...chat
    },
    ...over
  } as unknown as MobileSessionController
}

function TasksProvider(props: { open: () => void }): null {
  useBridgeBackgroundTasksToHeader(2, props.open)
  return null
}

async function mount(c: MobileSessionController) {
  captured.inputs.push([])
  await act(async () => {
    renderers.push(create(createElement(MobileSessionSheets, { controller: c })))
  })
}

const menu = () => captured.menu.at(-1)!
const renameInput = () => captured.inputs.at(-1)!.findLast((props) => props.title === 'Rename session')

describe('the header menu session entries, wired', () => {
  it('opens the session images check from the menu, and closes it', async () => {
    await mount(controller(vi.fn()))
    expect(captured.checks.at(-1)?.visible).toBe(false)
    await act(async () => menu().onCheckSessionImages?.())
    expect(captured.checks.at(-1)?.visible).toBe(true)
    await act(async () => captured.checks.at(-1)!.onClose())
    expect(captured.checks.at(-1)?.visible).toBe(false)
  })

  it('copies the branch name without its refs/heads/ prefix and says so', async () => {
    const showToast = vi.fn()
    await mount(controller(showToast))
    expect(menu().sessionEntries).toContain('copy-branch')
    await act(async () => menu().onCopyBranch?.())
    expect(clipboard.writeText).toHaveBeenCalledWith('feature/header')
    expect(showToast).toHaveBeenCalledWith('Branch name copied')
  })

  it("copies the agent's session id and says so", async () => {
    const showToast = vi.fn()
    await mount(controller(showToast))
    await act(async () => menu().onCopySessionId?.())
    expect(clipboard.writeText).toHaveBeenCalledWith('7f3c2b1a-0000-4000-8000-000000000000')
    expect(showToast).toHaveBeenCalledWith('Session ID copied')
  })

  it('opens the chat’s Background tasks sheet while tasks run', async () => {
    const open = vi.fn()
    act(() => {
      renderers.push(create(createElement(TasksProvider, { open })))
    })
    await mount(controller(vi.fn()))
    expect(menu().sessionEntries).toContain('background-tasks')
    act(() => menu().onOpenBackgroundTasks?.())
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('offers no Background tasks entry without a chat to open it in', async () => {
    await mount(controller(vi.fn()))
    expect(menu().sessionEntries).not.toContain('background-tasks')
  })

  it('asks for the new name in the Claude app’s words and writes it with worktree.set', async () => {
    const sendRequest = vi.fn(async () => ok)
    const showToast = vi.fn()
    await mount(controller(showToast, sendRequest))
    expect(renameInput()?.visible).toBe(false)
    await act(async () => menu().onRename?.())
    const input = renameInput()!
    expect(input.visible).toBe(true)
    expect(input.message).toBe('Enter a new name for this session')
    expect(input.placeholder).toBe('Enter session name')
    expect(input.defaultValue).toBe('Header parity')
    expect(input.submitLabel ?? 'Save').toBe('Save')
    await act(async () => {
      input.onSubmit('Header parity, take two')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(sendRequest.mock.calls.map((call) => (call as unknown[]).slice(0, 2))).toEqual([
      ['worktree.set', { worktree: 'id:repo-1::/work/header', displayName: 'Header parity, take two' }]
    ])
    expect(renameInput()?.visible).toBe(false)
    expect(showToast).not.toHaveBeenCalled()
  })

  // TextInputModal resets what was typed whenever its defaultValue changes while open, and the
  // live title can replace the route hint after the dialog opened (review, 2026-10-11).
  it('keeps the name the dialog opened with when the live title changes under it', async () => {
    const first = controller(vi.fn())
    await mount(first)
    await act(async () => menu().onRename?.())
    const renamed = { ...first, worktreeName: 'Live name from the host' } as MobileSessionController
    await act(async () => {
      renderers[0]!.update(createElement(MobileSessionSheets, { controller: renamed }))
    })
    expect(renameInput()?.visible).toBe(true)
    expect(renameInput()?.defaultValue).toBe('Header parity')
  })

  it('says a refused rename did not happen', async () => {
    const showToast = vi.fn()
    await mount(controller(showToast, vi.fn(async () => ({ id: 'set', ok: false, error: { code: 'x', message: 'no' }, _meta: { runtimeId: 'r' } }))))
    await act(async () => menu().onRename?.())
    await act(async () => {
      renameInput()!.onSubmit('New name')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(showToast).toHaveBeenCalledWith("Couldn't rename the session", 1500)
  })

  // --- Change model, Archive and the connection line (Batch 3) ---

  const archiveDialog = () => captured.confirms.findLast((props) => props.title === 'Archive session?')

  it('opens the composer’s own model sheet from Change model', async () => {
    const requestModelSheet = vi.fn()
    await mount(controller(vi.fn(), undefined, {}, { requestModelSheet }))
    expect(menu().sessionEntries).toContain('change-model')
    act(() => menu().onChangeModel?.())
    expect(requestModelSheet).toHaveBeenCalledTimes(1)
  })

  it('offers no Change model where the chat is not showing, or the agent has no model option', async () => {
    await mount(controller(vi.fn(), undefined, {}, { showNativeChat: false }))
    expect(menu().sessionEntries).not.toContain('change-model')
    captured.menu.length = 0
    await mount(controller(vi.fn(), undefined, {}, { nativeChatSessionOptions: null }))
    expect(menu().sessionEntries).not.toContain('change-model')
    captured.menu.length = 0
    await mount(
      controller(vi.fn(), undefined, {}, { nativeChatSessionOptions: { controller: { snapshot: [] } } })
    )
    expect(menu().sessionEntries).not.toContain('change-model')
  })

  it('asks before Archive closes the agent tab, then closes exactly that tab', async () => {
    const handleCloseSessionTab = vi.fn()
    await mount(controller(vi.fn(), undefined, { handleCloseSessionTab }))
    expect(menu().sessionEntries).toContain('archive')
    expect(archiveDialog()?.visible).toBe(false)
    await act(async () => menu().onArchive?.())
    const dialog = archiveDialog()!
    expect(dialog.visible).toBe(true)
    expect(dialog.confirmLabel).toBe('Archive')
    expect(dialog.destructive).toBe(true)
    // The app's Archive moves a session to its archived list; closing a tab does not, so the
    // dialog says what it does here instead of promising a list Orca does not have.
    expect(dialog.message).toBe('This closes the session’s tab on your computer.')
    expect(handleCloseSessionTab).not.toHaveBeenCalled()
    await act(async () => archiveDialog()!.onConfirm())
    expect(handleCloseSessionTab).toHaveBeenCalledTimes(1)
    expect(handleCloseSessionTab).toHaveBeenCalledWith(agentTab)
  })

  it('closes nothing when Archive is cancelled', async () => {
    const handleCloseSessionTab = vi.fn()
    await mount(controller(vi.fn(), undefined, { handleCloseSessionTab }))
    await act(async () => menu().onArchive?.())
    await act(async () => archiveDialog()!.onCancel())
    expect(handleCloseSessionTab).not.toHaveBeenCalled()
    expect(archiveDialog()?.visible).toBe(false)
  })

  it('offers no Archive on a plain shell tab or with no tab selected', async () => {
    await mount(controller(vi.fn(), undefined, { activeSessionTabId: 't2' }))
    expect(menu().sessionEntries).not.toContain('archive')
    captured.menu.length = 0
    await mount(controller(vi.fn(), undefined, { activeSessionTabId: null, visibleTabs: [] }))
    expect(menu().sessionEntries).not.toContain('archive')
  })

  it('says Connected over a live link', async () => {
    await mount(controller(vi.fn()))
    expect(menu().connection).toEqual({ text: 'Connected', connected: true })
  })

  it('names the desktop to reconnect from once the phone has given up on it and knows its name', async () => {
    hosts.list = [{ id: 'host-1', name: 'Alwin’s Mac', endpoint: 'ws://100.64.0.2:6768' }]
    await mount(
      controller(vi.fn(), undefined, {
        connState: 'reconnecting',
        connectionVerdict: { kind: 'unreachable', label: "Can't reach desktop", reason: 'stale' }
      })
    )
    expect(menu().connection).toEqual({
      text: 'Disconnected • Reconnect from Alwin’s Mac',
      connected: false
    })
  })

  it('says only Disconnected when the desktop’s name is not known', async () => {
    await mount(
      controller(vi.fn(), undefined, {
        connState: 'reconnecting',
        connectionVerdict: { kind: 'unreachable', label: "Can't reach desktop", reason: 'stale' }
      })
    )
    expect(menu().connection).toEqual({ text: 'Disconnected', connected: false })
  })
})
