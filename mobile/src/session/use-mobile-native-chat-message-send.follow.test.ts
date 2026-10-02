import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileNativeChatSendFollow } from './mobile-native-chat-send-follow'

const sendWithOutcome = vi.fn()
const clearInputWrite = vi.fn()
vi.mock('./mobile-native-chat-send', () => ({
  sendMobileNativeChatMessageWithOutcome: (...args: unknown[]) => sendWithOutcome(...args),
  typeMobileNativeChatCommandWithOutcome: vi.fn(),
  clearMobileNativeChatInput: (...args: unknown[]) => clearInputWrite(...args),
  openMobileNativeChatSendBudget: () => Date.now() + 15_000,
  MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS: 15_000,
  MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS: 2_000
}))
vi.mock('./mobile-native-chat-stale-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-stale-input')>()),
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))
// No screen on this suite's client: the looks a Claude send takes are mocked away
// (as in use-mobile-native-chat-message-send.test.ts).
vi.mock('./mobile-native-chat-screen-read', () => ({
  readMobileNativeChatScreen: vi.fn(() => Promise.resolve(null))
}))
vi.mock('./mobile-native-chat-submit-verify', () => ({
  verifyClaudeSubmit: () => Promise.resolve({ kind: 'unverified' })
}))

import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'

// The image hook's composer send follows its TAB, not the handle it started on, and
// hands this send the terminal it verified. A tab given another terminal before this
// wrote a byte goes back to that hook unsent and unsaid (`reminted`); a switch to
// another tab is said here, as before.

describe('the message send of a composer send that follows its tab', () => {
  let renderer: ReactTestRenderer | null = null
  let api: ReturnType<typeof useMobileNativeChatMessageSend> | null = null
  let clientState: 'connected' | 'disconnected' = 'connected'
  const handleRef = { current: 'term-1' as string | null }
  const clearDraftForSend = vi.fn()
  const restoreRejectedDraft = vi.fn()
  let onSendError = vi.fn()

  beforeEach(() => {
    sendWithOutcome.mockReset()
    sendWithOutcome.mockResolvedValue('accepted')
    clearInputWrite.mockReset()
    clearInputWrite.mockResolvedValue(true)
    clearDraftForSend.mockReset()
    restoreRejectedDraft.mockReset()
    onSendError = vi.fn()
    clientState = 'connected'
    handleRef.current = 'term-1'
    resetMobileNativeChatTerminalWritesForTests()
    function Probe(): null {
      api = useMobileNativeChatMessageSend({
        client: {
          sendRequest: vi.fn(),
          getState: () => clientState,
          notifyForeground: vi.fn()
        } as never,
        enabled: true,
        handleRef,
        deviceTokenRef: { current: 'device' },
        agentRef: { current: 'claude' },
        commandSendRef: { current: vi.fn() },
        captureSendOrigin: vi.fn(() => ({ draftKey: 'k', pendingKey: 'p' }) as never),
        readSeededLaunchDraftSeed: () => null,
        clearDraftForSend,
        restoreRejectedDraft,
        acceptSend: vi.fn(),
        holdUnconfirmedSend: vi.fn(),
        onSendError
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    api = null
  })

  const follow = (
    terminal: string,
    tabChanged: () => boolean = () => false
  ): MobileNativeChatSendFollow => ({
    terminal,
    tabChanged,
    reminted: false
  })
  const wroteNothing = (): void => {
    expect(clearInputWrite).not.toHaveBeenCalled()
    expect(sendWithOutcome).not.toHaveBeenCalled()
    expect(clearDraftForSend).not.toHaveBeenCalled()
    expect(restoreRejectedDraft).not.toHaveBeenCalled()
  }

  it('sends to the terminal it was handed, as any send does, when the tab still has it', async () => {
    const followed = follow('term-1')
    let outcome = ''
    await act(async () => {
      outcome = await api!.sendWithOutcome('hello', undefined, undefined, followed)
    })
    expect(outcome).toBe('accepted')
    expect(followed.reminted).toBe(false)
    expect(sendWithOutcome).toHaveBeenCalledOnce()
    expect(sendWithOutcome.mock.calls[0]![0]).toMatchObject({ terminal: 'term-1' })
  })

  it('hands the send back unsent, saying nothing, when the tab already has another terminal', async () => {
    handleRef.current = 'term-2'
    const followed = follow('term-1')
    let outcome = ''
    await act(async () => {
      outcome = await api!.sendWithOutcome('hello', undefined, undefined, followed)
    })
    expect(outcome).toBe('rejected')
    expect(followed.reminted).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
    wroteNothing()
  })

  it('hands the send back unsent when the tab is given another terminal while it waits for the link', async () => {
    clientState = 'disconnected'
    const followed = follow('term-1')
    let sending: Promise<string> = Promise.resolve('')
    act(() => {
      sending = api!.sendWithOutcome('hello', undefined, undefined, followed)
    })
    handleRef.current = 'term-2'
    clientState = 'connected'
    let outcome = ''
    await act(async () => {
      outcome = await sending
    })
    expect(outcome).toBe('rejected')
    expect(followed.reminted).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
    wroteNothing()
  })

  it('says the session changed, and does not hand it back, when the tab itself changes while it waits', async () => {
    clientState = 'disconnected'
    let switched = false
    const followed = follow('term-1', () => switched)
    let sending: Promise<string> = Promise.resolve('')
    act(() => {
      sending = api!.sendWithOutcome('hello', undefined, undefined, followed)
    })
    switched = true
    handleRef.current = 'term-9'
    clientState = 'connected'
    let outcome = ''
    await act(async () => {
      outcome = await sending
    })
    expect(outcome).toBe('rejected')
    expect(followed.reminted).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent (session changed)')
    wroteNothing()
  })

  it('says the session changed when the tab was switched before the send began', async () => {
    handleRef.current = 'term-9'
    const followed = follow('term-1', () => true)
    await act(async () => {
      await api!.sendWithOutcome('hello', undefined, undefined, followed)
    })
    expect(followed.reminted).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith('Message not sent (session changed)')
    wroteNothing()
  })

  // Degenerate: the tab lost its terminal; there is none to follow, so the send's own words apply.
  it('says there is no terminal, and does not hand it back, when the tab has none', async () => {
    handleRef.current = null
    const followed = follow('term-1')
    await act(async () => {
      await api!.sendWithOutcome('hello', undefined, undefined, followed)
    })
    expect(followed.reminted).toBe(false)
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(
      'Message not sent (no terminal on this tab)'
    )
    wroteNothing()
  })
})
