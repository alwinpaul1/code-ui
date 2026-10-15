// @vitest-environment happy-dom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { MobileSessionTab } from './mobile-session-route-types'
import { useMobileSessionTerminalSendActions } from './use-mobile-session-terminal-send-actions'
import type { MobileSessionTerminalWebviewModel } from './use-mobile-session-terminal-webview'

// The user, 2026-10-15: typing `claude` or `claudeai` in a terminal from the phone must start
// Claude Code in auto permission mode. Both of the phone's terminal inputs: the buffered field
// (whole line + Enter) and live input (already typed, Enter appends the tail).

const mocks = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>> }))

vi.mock('react-native', () => ({
  Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove: vi.fn() }) }
}))
vi.mock('../platform/haptics', () => ({ triggerError: vi.fn(), triggerMediumImpact: vi.fn() }))
vi.mock('../terminal/worker-terminal-takeover-report', () => ({
  reportWorkerTerminalUserInput: vi.fn()
}))
vi.mock('../terminal/mobile-terminal-operations', () => ({
  terminalInputSend: {
    request: async (_client: unknown, params: Record<string, unknown>) => {
      mocks.sent.push(params)
      return { ok: true }
    },
    interpret: () => true
  }
}))

const SHELL_TAB: MobileSessionTab = {
  type: 'terminal',
  id: 'tab-1',
  title: 'zsh',
  terminal: 'terminal-a',
  isActive: true
}

type Setup = {
  readonly draft: string
  readonly hostPlatform: NodeJS.Platform | null
  readonly tab: MobileSessionTab
}

type Actions = ReturnType<typeof useMobileSessionTerminalSendActions>

function mount(setup: Setup, liveSubmit: (rewrite?: (line: string) => string | null) => Promise<boolean>) {
  const noop = (): void => {}
  const client = { getState: () => 'connected' }
  const scope = {
    client,
    activeHandle: 'terminal-a',
    activeSessionTab: setup.tab,
    setActionTarget: noop,
    setMarkdownActionTarget: noop,
    setFileActionTarget: noop,
    setBrowserActionTarget: noop,
    setAgentSessionActionTarget: noop,
    keyboardHeight: 0,
    deviceTokenRef: { current: null },
    clientRef: { current: client },
    connStateRef: { current: 'connected' },
    liveInputRef: { current: null },
    commandInputRef: { current: null },
    liveInputFocusTimerRef: { current: null },
    sendLiveTerminalInputRef: { current: async () => true },
    sessionTabActionSheetKeyboardHideSubRef: { current: null },
    sessionTabActionSheetRequestSeqRef: { current: 0 },
    activeHandleRef: { current: 'terminal-a' },
    activeSessionTabTypeRef: { current: 'terminal' },
    sendingRef: { current: false },
    bufferedTerminalDraftState: {
      input: setup.draft,
      beginBufferedTerminalDraftSend: (handle: string, draft: string) => ({ draft, handle }),
      restoreRejectedDraft: noop,
      settleBufferedTerminalDraftSend: () => true
    },
    getSendCompletionGeneration: () => 0,
    getLiveInteractionGeneration: () => 0,
    handleLiveInputAccessoryBytes: async () => ({ kind: 'allow-raw' }),
    handleLiveInputSubmit: liveSubmit,
    canSend: true,
    scheduleDelayedAction: noop,
    showToast: noop,
    releaseLiveInputKeyboard: noop,
    hostPlatformRef: { current: setup.hostPlatform }
  }
  let actions: Actions | null = null
  function Harness(): null {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook destructures only the keys above on the paths under test.
    actions = useMobileSessionTerminalSendActions(scope as unknown as MobileSessionTerminalWebviewModel)
    return null
  }
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(Harness))
  })
  if (!actions) {
    throw new Error('send actions did not render')
  }
  const mounted: Actions = actions
  return { actions: mounted, unmount: () => act(() => renderer?.unmount()) }
}

async function bufferedSend(setup: Setup): Promise<unknown> {
  mocks.sent.length = 0
  const { actions, unmount } = mount(setup, async () => true)
  await act(async () => {
    await actions.handleSend()
  })
  unmount()
  return mocks.sent[0]?.text
}

describe('a claude line sent from the buffered terminal field', () => {
  it('`claude` and `claudeai` at a shell start in auto mode', async () => {
    expect(await bufferedSend({ draft: 'claude', hostPlatform: 'darwin', tab: SHELL_TAB })).toBe(
      'claude --permission-mode auto'
    )
    expect(await bufferedSend({ draft: 'claudeai', hostPlatform: 'linux', tab: SHELL_TAB })).toBe(
      'claudeai --permission-mode auto'
    )
  })

  it('a line with its own permission flag, or that is not a launch, goes as typed', async () => {
    const send = (draft: string) => bufferedSend({ draft, hostPlatform: 'darwin', tab: SHELL_TAB })
    expect(await send('claude --permission-mode plan')).toBe('claude --permission-mode plan')
    expect(await send('claude mcp list')).toBe('claude mcp list')
    expect(await send('ls -la')).toBe('ls -la')
  })

  it('a pane an agent owns, and a Windows host, get the line as typed', async () => {
    expect(
      await bufferedSend({ draft: 'claude', hostPlatform: 'darwin', tab: { ...SHELL_TAB, launchAgent: 'claude' } })
    ).toBe('claude')
    expect(await bufferedSend({ draft: 'claude', hostPlatform: 'win32', tab: SHELL_TAB })).toBe('claude')
  })
})

describe('a claude line submitted from live input', () => {
  it('hands the live submit a rewrite that starts `claude` in auto mode', () => {
    const liveSubmit = vi.fn(async (_rewrite?: (line: string) => string | null) => true)
    const { actions, unmount } = mount({ draft: '', hostPlatform: 'darwin', tab: SHELL_TAB }, liveSubmit)
    act(() => {
      actions.submitLiveInput()
    })
    const rewrite = liveSubmit.mock.calls[0]?.[0]
    expect(rewrite?.('claude')).toBe('claude --permission-mode auto')
    expect(rewrite?.('echo claude')).toBeNull()
    unmount()
  })
})
