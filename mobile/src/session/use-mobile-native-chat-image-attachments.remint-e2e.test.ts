import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { createFakeComposerHost } from './fake-claude-composer-host.test-support'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import { hostTerminalOfTab, SEND_TERMINAL_RESTARTED } from './mobile-native-chat-send-follow'
import { readSendUnderDialogRefusal } from './mobile-native-chat-dialog-guard'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import type { MobileSessionTab } from './mobile-session-route-types'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileSessionCloseActions } from './use-mobile-session-close-actions'
import type { MobileSessionContentCreateActionsModel } from './use-mobile-session-content-create-actions'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { baseArgs, SCOPE_A } from './use-mobile-native-chat-image-attachments.test-support'

vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: vi.fn() }) }))
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileDocuments: vi.fn(),
  pickMobileImageFiles: vi.fn()
}))
vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))
vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))

// Two ends that the other remint suite fakes apart: the REAL close-terminal action,
// whose hop re-points the active handle at another tab's terminal, and the REAL
// message send behind a send that follows its tab, against a stand-in for Claude
// Code's input. Handles are Orca's `term_<uuid>`; the tab's own is named by the
// host's session-tab snapshot (hostTerminalOfTab).

const TAB_A: MobileSessionTab = {
  type: 'terminal',
  id: 'tab-a',
  title: 'claude',
  terminal: 'term-1',
  launchAgent: 'claude',
  isActive: true
} as MobileSessionTab

const ok = (result: unknown): RpcResponse => ({
  id: 'r',
  ok: true,
  result,
  _meta: { runtimeId: 'r' }
})
const read = (lines: string[]): RpcResponse => ok({ terminal: { lines, source: 'screen' } })

describe('a composer send that follows its tab, end to end', () => {
  let renderer: ReactTestRenderer | null = null
  let image: ReturnType<typeof useMobileNativeChatImageAttachments> | null = null
  let send: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  let close: ReturnType<typeof useMobileSessionCloseActions> | null = null
  const activeHandleRef = { current: 'term-1' as string | null }
  const sessionTabsRef = { current: [TAB_A] as MobileSessionTab[] }
  const onSendError = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    activeHandleRef.current = 'term-1'
    sessionTabsRef.current = [TAB_A]
    onSendError.mockReset()
    resetMobileNativeChatTerminalWritesForTests()
    resetMobileNativeChatStaleInputForTests()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  /** `onTerm1` runs when the phone first reads term-1's screen (its look); `screens` answers the rest. */
  function mount(client: RpcClient, closeScope?: Record<string, unknown>) {
    function Harness(): null {
      send = useMobileNativeChatMessageSend({
        client,
        enabled: true,
        handleRef: activeHandleRef,
        deviceTokenRef: { current: 'device' },
        agentRef: { current: 'claude' },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: () => ({ draftKey: 'k', pendingKey: 'p' }) as never,
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend: vi.fn(),
        restoreRejectedDraft: vi.fn(),
        acceptSend: vi.fn(),
        holdUnconfirmedSend: vi.fn(),
        onSendError
      })
      image = useMobileNativeChatImageAttachments(
        baseArgs({
          client,
          activeHandleRef,
          refuseUnderDialog: readSendUnderDialogRefusal,
          hostTerminalOfTab: (scopeKey) =>
            hostTerminalOfTab(sessionTabsRef.current, 'h', 'w', scopeKey),
          // What controller.handleNativeChatSendWithOutcome hands on: the follow is the 5th argument.
          baseSend: (text, images, deadline, _attachments, follow) =>
            send!.sendWithOutcome(text, images, deadline, follow),
          onSendError
        })
      )
      close = useMobileSessionCloseActions({
        client,
        terminals: [{ handle: 'term-9', title: 'other', isActive: false }],
        terminalsRef: { current: [] },
        setTerminals: vi.fn(),
        setSessionTabs: vi.fn(),
        sessionTabsRef,
        activeHandleRef,
        pendingActiveTerminalHandleRef: { current: null },
        terminalRefs: { current: new Map() },
        initializedHandlesRef: { current: new Set() },
        clearTerminalLiveInputDefault: vi.fn(),
        unsubscribeTerminal: vi.fn(),
        subscribeToTerminal: vi.fn(),
        setActiveHandle: vi.fn(),
        ...closeScope
      } as unknown as MobileSessionContentCreateActionsModel)
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
  }

  async function tap(text: string): Promise<boolean> {
    let sent = false
    await act(async () => {
      const sending = image!.sendNativeChat(text)
      await vi.runAllTimersAsync()
      sent = await sending
    })
    return sent
  }

  it("reaches the new terminal's Claude once, as the message and nothing else, when the tab is given it during the look", async () => {
    const claude = createFakeComposerHost()
    const toOld: string[] = []
    const client = {
      getState: () => 'connected',
      notifyForeground: vi.fn(),
      getLastConnectedAt: () => 1,
      sendRequest: vi.fn(async (method: string, params: unknown) => {
        const terminal = (params as { terminal?: string }).terminal
        if (terminal === 'term-1') {
          toOld.push(method)
          // The tab is given a new terminal (a PTY restart) while the look reads the old one,
          // and the host's snapshot names it.
          activeHandleRef.current = 'term-2'
          sessionTabsRef.current = [{ ...TAB_A, terminal: 'term-2' } as MobileSessionTab]
          return read(EMPTY_COMPOSER)
        }
        return claude.handle(method, params)
      })
    } as unknown as RpcClient
    mount(client)
    expect(await tap('deploy the staging build')).toBe(true)
    expect(claude.submitted).toEqual(['deploy the staging build'])
    // Term-1 was only ever looked at; nothing was written to it.
    expect(toOld).toEqual(['terminal.read'])
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('refuses, writing nothing, when the new terminal shows no composer', async () => {
    const toNew: string[] = []
    const client = {
      getState: () => 'connected',
      notifyForeground: vi.fn(),
      getLastConnectedAt: () => 1,
      sendRequest: vi.fn(async (method: string, params: unknown) => {
        const terminal = (params as { terminal?: string }).terminal
        if (terminal === 'term-1') {
          activeHandleRef.current = 'term-2'
          sessionTabsRef.current = [{ ...TAB_A, terminal: 'term-2' } as MobileSessionTab]
          return read(EMPTY_COMPOSER)
        }
        toNew.push(method)
        return read(['alwin@mac Code UI % '])
      })
    } as unknown as RpcClient
    mount(client)
    expect(await tap('rm -rf build')).toBe(false)
    expect(toNew.filter((method) => method === 'terminal.send')).toEqual([])
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(SEND_TERMINAL_RESTARTED)
  })

  // Opus review of the follow: closing the active terminal re-points the phone's active
  // handle at ANOTHER tab's terminal without touching the tab, so the scope key is
  // unchanged. Only the host's snapshot may say a handle is this tab's.
  it("does not send into the other tab's Claude when the active terminal is closed during the look", async () => {
    const claude = createFakeComposerHost()
    const writes: string[] = []
    let closing: Promise<boolean> | null = null
    const client = {
      getState: () => 'connected',
      notifyForeground: vi.fn(),
      getLastConnectedAt: () => 1,
      sendRequest: vi.fn(async (method: string, params: unknown) => {
        const terminal = (params as { terminal?: string }).terminal
        if (method === 'terminal.close') {
          return ok({ closed: true })
        }
        if (terminal === 'term-1') {
          // The user closes this tab's terminal from the action sheet while the look reads it.
          closing = close!.handleCloseTerminal({
            handle: 'term-1',
            title: 'claude',
            isActive: true
          })
          await closing
          return read(EMPTY_COMPOSER)
        }
        if (method === 'terminal.send') {
          writes.push(String((params as { text?: string }).text))
        }
        return claude.handle(method, params)
      })
    } as unknown as RpcClient
    mount(client)
    expect(await tap('deploy the staging build')).toBe(false)
    expect(activeHandleRef.current).toBe('term-9')
    expect(writes).toEqual([])
    expect(claude.submitted).toEqual([])
    expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent (session changed)')
  })

  it('does not follow a handle the snapshot names for no tab of this scope', async () => {
    const claude = createFakeComposerHost()
    const client = {
      getState: () => 'connected',
      notifyForeground: vi.fn(),
      getLastConnectedAt: () => 1,
      sendRequest: vi.fn(async (method: string, params: unknown) => {
        if ((params as { terminal?: string }).terminal === 'term-1') {
          activeHandleRef.current = 'term-7'
          return read(EMPTY_COMPOSER)
        }
        return claude.handle(method, params)
      })
    } as unknown as RpcClient
    mount(client)
    expect(hostTerminalOfTab(sessionTabsRef.current, 'h', 'w', SCOPE_A)).toBe('term-1')
    expect(await tap('hello')).toBe(false)
    expect(claude.submitted).toEqual([])
    expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent (session changed)')
  })
})
