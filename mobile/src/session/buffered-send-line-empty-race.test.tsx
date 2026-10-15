// @vitest-environment happy-dom
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTerminalLiveInputCommit } from '../terminal/use-terminal-live-input-commit'
import type { MobileSessionTab } from './mobile-session-route-types'
import { useMobileSessionTerminalSendActions } from './use-mobile-session-terminal-send-actions'
import type { MobileSessionTerminalWebviewModel } from './use-mobile-session-terminal-webview'

// Review of 6c1332c7a: in buffered mode a strip key tapped while the composer's Enter was in
// flight did not count as touching the line, so the Enter's late "line is empty" mark stood.
// Buffered send `ls`, then ↑ and Home inside the round trip, then `claude ` sent
// `claude --permission-mode auto` in front of the recalled `ls`: `claude --permission-mode autols`.

const mocks = vi.hoisted(() => ({
  sent: [] as string[],
  raw: [] as string[],
  gate: null as Promise<void> | null
}))

vi.mock('react-native', () => ({
  Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove: vi.fn() }) }
}))
vi.mock('../platform/haptics', () => ({ triggerError: vi.fn(), triggerMediumImpact: vi.fn() }))
vi.mock('../terminal/worker-terminal-takeover-report', () => ({
  reportWorkerTerminalUserInput: vi.fn()
}))
vi.mock('../terminal/mobile-terminal-operations', () => ({
  terminalInputSend: {
    request: async (_client: unknown, params: { text: string }) => {
      mocks.sent.push(params.text)
      if (mocks.gate) {
        await mocks.gate
      }
      return { ok: true }
    },
    interpret: () => true
  }
}))
vi.mock('../terminal/terminal-live-accessory-raw-send', () => ({
  sendTerminalLiveAccessoryRawBytes: async ({ bytes }: { bytes: string }) => {
    mocks.raw.push(bytes)
  }
}))

const HANDLE = 'terminal-a'
const SHELL_TAB: MobileSessionTab = {
  type: 'terminal',
  id: 'tab-1',
  title: 'zsh',
  terminal: HANDLE,
  isActive: true
}

type Actions = ReturnType<typeof useMobileSessionTerminalSendActions>
type Live = ReturnType<typeof useTerminalLiveInputCommit<string>>

function mountBufferedTerminal() {
  const noop = (): void => {}
  const client = { getState: () => 'connected' }
  const draft = { input: '' }
  // Buffered mode: the handle is NOT a live-input handle.
  const liveHandles = new Set<string>()
  let actions: Actions | null = null
  let live: Live | null = null
  function Harness(): null {
    live = useTerminalLiveInputCommit({
      activeHandle: HANDLE,
      activeHandleRef: { current: HANDLE },
      activeSessionTabType: 'terminal',
      activeSessionTabTypeRef: { current: 'terminal' },
      connected: true,
      liveInputRef: { current: null },
      liveInputTerminalHandles: liveHandles,
      liveInputTerminalHandlesRef: { current: liveHandles },
      sendLiveTerminalInputRef: { current: async () => true },
      setLiveInputCapture: noop
    })
    const scope = {
      ...live,
      client,
      activeHandle: HANDLE,
      activeSessionTab: SHELL_TAB,
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
      activeHandleRef: { current: HANDLE },
      activeSessionTabTypeRef: { current: 'terminal' },
      sendingRef: { current: false },
      bufferedTerminalDraftState: {
        get input() {
          return draft.input
        },
        beginBufferedTerminalDraftSend: (handle: string, text: string) => ({ draft: text, handle }),
        restoreRejectedDraft: noop,
        settleBufferedTerminalDraftSend: () => true
      },
      getSendCompletionGeneration: () => 0,
      getLiveInteractionGeneration: live.getLiveInputInteractionGeneration,
      canSend: true,
      scheduleDelayedAction: noop,
      showToast: noop,
      releaseLiveInputKeyboard: noop,
      hostPlatformRef: { current: 'darwin' }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook destructures only the keys above on the paths under test.
    actions = useMobileSessionTerminalSendActions(scope as unknown as MobileSessionTerminalWebviewModel)
    return null
  }
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(Harness))
  })
  if (!actions || !live) {
    throw new Error('buffered terminal did not render')
  }
  const mountedActions: Actions = actions
  const mountedLive: Live = live
  return {
    actions: mountedActions,
    live: mountedLive,
    draft,
    unmount: () => act(() => renderer?.unmount())
  }
}

describe('a buffered send whose Enter is still in flight', () => {
  let unmount: (() => void) | null = null
  afterEach(() => {
    unmount?.()
    unmount = null
    mocks.sent.length = 0
    mocks.raw.length = 0
    mocks.gate = null
  })

  it('a strip key tapped meanwhile keeps the next claude line from being rewritten', async () => {
    const terminal = mountBufferedTerminal()
    unmount = terminal.unmount
    terminal.live.markLiveInputLineEmpty(HANDLE)

    let release: () => void = () => {}
    mocks.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    terminal.draft.input = 'ls'
    let firstSend: Promise<void> = Promise.resolve()
    act(() => {
      firstSend = terminal.actions.handleSend()
    })
    // ↑ and Home inside the round trip: the shell recalls `ls` and puts the cursor before it.
    await act(async () => {
      await terminal.actions.handleAccessoryKey({ bytes: '\x1b[A' })
      await terminal.actions.handleAccessoryKey({ bytes: '\x1b[H' })
    })
    expect(mocks.raw).toEqual(['\x1b[A', '\x1b[H'])
    mocks.gate = null
    release()
    await act(async () => {
      await firstSend
    })

    terminal.draft.input = 'claude '
    await act(async () => {
      await terminal.actions.handleSend()
    })
    expect(mocks.sent).toEqual(['ls', 'claude '])
  })

  it('with nothing else reaching the terminal, the next claude line is rewritten', async () => {
    const terminal = mountBufferedTerminal()
    unmount = terminal.unmount
    terminal.live.markLiveInputLineEmpty(HANDLE)
    terminal.draft.input = 'ls'
    await act(async () => {
      await terminal.actions.handleSend()
    })
    terminal.draft.input = 'claude'
    await act(async () => {
      await terminal.actions.handleSend()
    })
    expect(mocks.sent).toEqual(['ls', 'claude --permission-mode auto'])
  })
})
