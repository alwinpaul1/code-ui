import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Rename on a Claude tab matched to its Anthropic session. The Claude app renames the session
 * itself (`PUT v1/code/sessions/{id}` with `{title}`, ccr-session-writes.ts); the phone's token has
 * never been shown to be allowed that, so it goes there only while CCR_SESSION_WRITES is on. Off,
 * Rename must stay exactly what it was: the workspace, through `worktree.set`.
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
const writes = vi.hoisted(() => ({ on: false, outcome: 'renamed' as 'renamed' | 'refused' | 'failed', calls: [] as { target: unknown; title: string }[] }))

vi.mock('./ccr-session-writes', () => ({
  get CCR_SESSION_WRITES() {
    return writes.on
  },
  renameCcrSessionFromHeader: async (session: { resolveTarget: () => unknown }, title: string) => {
    writes.calls.push({ target: session.resolveTarget(), title })
    return writes.outcome
  }
}))

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-secure-store', () => ({ setItemAsync: vi.fn(), getItemAsync: vi.fn(async () => null), deleteItemAsync: vi.fn() }))
vi.mock('expo-crypto', () => ({ getRandomBytes: vi.fn(), digestStringAsync: vi.fn() }))
vi.mock('expo-linking', () => ({ openURL: vi.fn() }))
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
import type { MobileSessionController } from './use-mobile-session-controller'
import { useCcrSessionHeader, type CcrSessionHeader } from './use-ccr-session-header'
import { claudeSessionHeaderTitle, noteCcrSessionFacts, resetCcrSessionFactsForTests } from './ccr-session-facts'
import { resetCcrCacheForTests, setCcrMapping } from './ccr-session-cache'
import { parseCcrSessionRow } from './ccr-session-row'

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
  writes.on = false
  writes.outcome = 'renamed'
  writes.calls.length = 0
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


const anthropicSession = {
  sessionId: 'cse_01QXaaaaaaaaaaaaaaaaaaaa',
  title: 'CI failure on main',
  resolveTarget: () => ({ kind: 'target', sessionId: 'cse_01QXaaaaaaaaaaaaaaaaaaaa', accountId: 'acct-1' })
}

async function mount(c: MobileSessionController) {
  captured.inputs.push([])
  await act(async () => {
    renderers.push(create(createElement(MobileSessionSheets, { controller: c })))
  })
}

const menu = () => captured.menu.at(-1)!
const renameInput = () => captured.inputs.at(-1)!.findLast((props) => props.title === 'Rename session')


async function submitRename(name: string) {
  await act(async () => menu().onRename?.())
  await act(async () => {
    renameInput()!.onSubmit(name)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('Rename on a Claude tab matched to its Anthropic session', () => {
  it('still renames the workspace while the session writes switch is off', async () => {
    const sendRequest = vi.fn(async () => ok)
    await mount(controller(vi.fn(), sendRequest, {}, { nativeChatAnthropicSession: anthropicSession }))
    await act(async () => menu().onRename?.())
    expect(renameInput()?.defaultValue).toBe('Header parity')
    await act(async () => {
      renameInput()!.onSubmit('New name')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(writes.calls).toEqual([])
    expect(sendRequest.mock.calls.map((call) => (call as unknown[]).slice(0, 2))).toEqual([
      ['worktree.set', { worktree: 'id:repo-1::/work/header', displayName: 'New name' }]
    ])
  })

  it('renames the session itself, starting from its title, once the switch is on', async () => {
    writes.on = true
    const sendRequest = vi.fn(async () => ok)
    const showToast = vi.fn()
    await mount(controller(showToast, sendRequest, {}, { nativeChatAnthropicSession: anthropicSession }))
    await act(async () => menu().onRename?.())
    expect(renameInput()?.defaultValue).toBe('CI failure on main')
    await act(async () => {
      renameInput()!.onSubmit('Login bug')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(writes.calls).toEqual([{ target: { kind: 'target', sessionId: 'cse_01QXaaaaaaaaaaaaaaaaaaaa', accountId: 'acct-1' }, title: 'Login bug' }])
    expect(sendRequest).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('says a rename Anthropic refused did not happen', async () => {
    writes.on = true
    writes.outcome = 'failed'
    const showToast = vi.fn()
    await mount(controller(showToast, vi.fn(async () => ok), {}, { nativeChatAnthropicSession: anthropicSession }))
    await submitRename('Login bug')
    expect(showToast).toHaveBeenCalledWith("Couldn't rename the session", 1500)
  })

  it('renames the workspace on a tab with no matched session, switch on or not', async () => {
    writes.on = true
    const sendRequest = vi.fn(async () => ok)
    await mount(controller(vi.fn(), sendRequest, {}, { nativeChatAnthropicSession: null }))
    await submitRename('New name')
    expect(writes.calls).toEqual([])
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })
})

// Reported 2026-10-15 (review of the session-title branch): with the switch off the header showed
// the Anthropic session title while Rename renamed the workspace, so a rename changed nothing on
// screen and the dialog opened on the workspace name, not the name in the header. The header's
// title and Rename's target are now the same thing: the session title only while the switch is
// on, the worktree name otherwise. The header object comes from the real hook here, with the
// switch read the way the app reads it (the CCR_SESSION_WRITES constant, mocked above).
describe('the header and Rename name the same thing', () => {
  const SESSION = 'cse_01QXaaaaaaaaaaaaaaaaaaaa'
  const RENAMED_WORKTREE = 'Renamed on the desktop'
  let headerRenderer: ReactTestRenderer | null = null
  let header: CcrSessionHeader | null = null

  function HeaderProbe() {
    header = useCcrSessionHeader({ enabled: true, tabId: 't1', epoch: 1 })
    return null
  }

  async function mountHeader() {
    resetCcrCacheForTests()
    resetCcrSessionFactsForTests()
    setCcrMapping('t1', SESSION, 1, 'acct-1')
    noteCcrSessionFacts('t1', 1, parseCcrSessionRow({ id: SESSION, title: 'CI failure on main' })!, Date.now())
    await act(async () => {
      headerRenderer = create(createElement(HeaderProbe))
    })
  }

  afterEach(() => {
    act(() => headerRenderer?.unmount())
    headerRenderer = null
    header = null
    resetCcrSessionFactsForTests()
    resetCcrCacheForTests()
  })

  it('shows the worktree name, which Rename renames, while the switch is off', async () => {
    await mountHeader()
    expect(header).toBeNull()
    expect(claudeSessionHeaderTitle(header?.title ?? null, RENAMED_WORKTREE)).toBe(RENAMED_WORKTREE)
    await mount(controller(vi.fn(), vi.fn(async () => ok), { worktreeName: RENAMED_WORKTREE }, { nativeChatAnthropicSession: header }))
    await act(async () => menu().onRename?.())
    expect(renameInput()?.defaultValue).toBe(RENAMED_WORKTREE)
  })

  it('shows the session title, and the dialog starts from it, once the switch is on', async () => {
    writes.on = true
    await mountHeader()
    expect(header).toMatchObject({ sessionId: SESSION, title: 'CI failure on main' })
    expect(claudeSessionHeaderTitle(header?.title ?? null, RENAMED_WORKTREE)).toBe('CI failure on main')
    await mount(controller(vi.fn(), vi.fn(async () => ok), { worktreeName: RENAMED_WORKTREE }, { nativeChatAnthropicSession: header }))
    await act(async () => menu().onRename?.())
    expect(renameInput()?.defaultValue).toBe('CI failure on main')
  })
})
