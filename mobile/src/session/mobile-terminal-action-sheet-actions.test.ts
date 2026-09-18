import { describe, expect, it, vi } from 'vitest'
import { getMobileTerminalActionSheetActions } from './mobile-terminal-action-sheet-actions'

vi.mock('lucide-react-native', () => ({
  Eraser: vi.fn(),
  GitBranch: vi.fn(),
  MessageSquare: vi.fn(),
  Monitor: vi.fn(),
  Smartphone: vi.fn(),
  SquareTerminal: vi.fn()
}))

type SheetArgs = Parameters<typeof getMobileTerminalActionSheetActions>[0]

function buildActions(overrides: Partial<SheetArgs> = {}) {
  return getMobileTerminalActionSheetActions({
    target: { handle: 'terminal-1' },
    tabs: [],
    isTabChatView: () => false,
    nativeChatTranscriptIsLocalReadable: true,
    onDismiss: vi.fn(),
    onToggleChat: vi.fn(),
    isPhoneMode: () => false,
    onToggleDisplayMode: vi.fn(),
    onRename: vi.fn(),
    onClear: vi.fn(),
    onFork: vi.fn(),
    onClose: vi.fn(),
    onCloseSessionTab: vi.fn(),
    ...overrides
  })
}

const terminalTab = (
  id: string,
  handle: string | null,
  agentStatus?: { agentType?: string; state?: string }
) => ({
  type: 'terminal',
  id,
  terminal: handle,
  ...(agentStatus ? { agentStatus } : {})
})

describe('getMobileTerminalActionSheetActions', () => {
  it('defers Rename until after the action sheet closes', () => {
    const target = { handle: 'terminal-1' }
    const onDismiss = vi.fn()
    const onRename = vi.fn()
    const actions = buildActions({ target, onDismiss, onRename })

    const rename = actions.find((action) => action.label === 'Rename')
    expect(rename).toMatchObject({ closeBeforePress: true })

    rename?.onPress()
    expect(onRename).toHaveBeenCalledWith(target)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  // Why: handle-only close lets the pending-terminal effect resurrect the tab (#6927, #7345).
  it('closes the handle through its session tab, not the handle-only path', () => {
    const onClose = vi.fn()
    const onCloseSessionTab = vi.fn()
    const tab = terminalTab('tab-1::leaf-1', 'terminal-1')
    const actions = buildActions({
      target: { handle: 'terminal-1' },
      tabs: [tab],
      onClose,
      onCloseSessionTab
    })

    actions.find((action) => action.label === 'Close')?.onPress()
    expect(onCloseSessionTab).toHaveBeenCalledWith(tab)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes the split leaf that owns the handle, not its sibling', () => {
    const onCloseSessionTab = vi.fn()
    const first = terminalTab('tab-1::leaf-1', 'terminal-1')
    const second = terminalTab('tab-1::leaf-2', 'terminal-2')
    const actions = buildActions({
      target: { handle: 'terminal-2' },
      tabs: [first, second],
      onCloseSessionTab
    })

    actions.find((action) => action.label === 'Close')?.onPress()
    expect(onCloseSessionTab).toHaveBeenCalledWith(second)
  })

  it('falls back to the handle close when no session tab owns the handle', () => {
    const onClose = vi.fn()
    const onCloseSessionTab = vi.fn()
    const target = { handle: 'terminal-9' }
    const actions = buildActions({
      target,
      tabs: [terminalTab('tab-1::leaf-1', 'terminal-1'), terminalTab('tab-2::leaf-1', null)],
      onClose,
      onCloseSessionTab
    })

    actions.find((action) => action.label === 'Close')?.onPress()
    expect(onClose).toHaveBeenCalledWith(target)
    expect(onCloseSessionTab).not.toHaveBeenCalled()
  })

  describe('Fork', () => {
    it('offers it for an idle Claude Code pane', () => {
      const tab = terminalTab('tab-1::leaf-1', 'terminal-1', { agentType: 'claude', state: 'done' })
      const actions = buildActions({ target: { handle: 'terminal-1' }, tabs: [tab] })
      expect(actions.some((action) => action.label === 'Fork')).toBe(true)
    })

    it('dismisses the sheet and forks the pressed target', () => {
      const onDismiss = vi.fn()
      const onFork = vi.fn()
      const target = { handle: 'terminal-1' }
      const tab = terminalTab('tab-1::leaf-1', 'terminal-1', { agentType: 'claude', state: 'done' })
      const actions = buildActions({ target, tabs: [tab], onDismiss, onFork })

      actions.find((action) => action.label === 'Fork')?.onPress()
      expect(onDismiss).toHaveBeenCalled()
      expect(onFork).toHaveBeenCalledWith(target)
    })

    it.each([
      ['a turn is running', { agentType: 'claude', state: 'working' }],
      ['a permission prompt is up', { agentType: 'claude', state: 'blocked' }],
      ['a question prompt is up', { agentType: 'claude', state: 'waiting' }]
    ])('is left out while %s', (_label, agentStatus) => {
      const tab = terminalTab('tab-1::leaf-1', 'terminal-1', agentStatus)
      const actions = buildActions({ target: { handle: 'terminal-1' }, tabs: [tab] })
      expect(actions.some((action) => action.label === 'Fork')).toBe(false)
    })

    it('is left out for Codex, which has no /fork', () => {
      const tab = terminalTab('tab-1::leaf-1', 'terminal-1', { agentType: 'codex', state: 'done' })
      const actions = buildActions({ target: { handle: 'terminal-1' }, tabs: [tab] })
      expect(actions.some((action) => action.label === 'Fork')).toBe(false)
    })

    it('is left out with no matching session tab (identity unknown, not assumed Claude)', () => {
      const actions = buildActions({ target: { handle: 'terminal-9' }, tabs: [] })
      expect(actions.some((action) => action.label === 'Fork')).toBe(false)
    })
  })

  describe('Ask about this screen', () => {
    it('is offered when a chat target resolves, and dismisses before firing', () => {
      const onDismiss = vi.fn()
      const onAskAboutScreen = vi.fn()
      const target = { handle: 'terminal-1' }
      const actions = buildActions({
        target,
        onDismiss,
        onAskAboutScreen,
        resolveAskAboutScreenTarget: () => ({ targetTab: { id: 'chat' }, agent: 'claude' })
      })

      const entry = actions.find((action) => action.label === 'Ask about this screen')
      expect(entry).toBeDefined()
      entry?.onPress()
      expect(onDismiss).toHaveBeenCalled()
      expect(onAskAboutScreen).toHaveBeenCalledWith(target)
    })

    it('is left off the menu when resolution finds nowhere for the text to land', () => {
      const actions = buildActions({
        onAskAboutScreen: vi.fn(),
        resolveAskAboutScreenTarget: () => null
      })
      expect(actions.some((action) => action.label === 'Ask about this screen')).toBe(false)
    })

    it('is left off the menu when the caller does not support it at all', () => {
      // No resolveAskAboutScreenTarget/onAskAboutScreen passed — same as
      // buildActions()'s defaults, which is the pre-feature shape.
      const actions = buildActions()
      expect(actions.some((action) => action.label === 'Ask about this screen')).toBe(false)
    })
  })
})
