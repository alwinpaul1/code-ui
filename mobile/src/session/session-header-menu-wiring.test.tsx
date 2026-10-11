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
  onCopyBranch?: () => void
  onOpenBackgroundTasks?: () => void
  onRename?: () => void
  onCopySessionId?: () => void
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
const captured = vi.hoisted(() => ({ menu: [] as MenuProps[], inputs: [] as InputProps[][] }))
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
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: () => null }))
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
  clipboard.writeText.mockClear()
})

const ok = { id: 'set', ok: true, result: { worktree: {} }, _meta: { runtimeId: 'r' } }

function controller(
  showToast: (message: string) => void,
  sendRequest: (...args: unknown[]) => Promise<unknown> = vi.fn(async () => ok)
) {
  const noop = () => {}
  return {
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
      isTabChatView: () => true,
      nativeChatSessionIdentity: { sessionId: '7f3c2b1a-0000-4000-8000-000000000000', transcriptPath: null, nestedSessionId: null }
    }
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
})
