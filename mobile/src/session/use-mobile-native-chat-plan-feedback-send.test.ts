import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite,
  resetMobileNativeChatTerminalWritesForTests
} from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatPlanFeedbackSend } from './use-mobile-native-chat-plan-feedback-send'

const HIGHLIGHTED_OPTION_3_SCREEN = [
  ' Claude has written up a plan and is ready to execute. Would you like to proceed?',
  '   1. Yes, and use auto mode',
  '     2. Yes, manually approve edits',
  '   ❯ 3. Tell Claude what to change'
]

describe('useMobileNativeChatPlanFeedbackSend', () => {
  let renderer: ReactTestRenderer | null = null
  let respond: ((send: string, comment: string) => Promise<boolean>) | null = null

  beforeEach(() => {
    resetMobileNativeChatTerminalWritesForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    respond = null
  })

  it('selects, verifies, types the comment, and reports acceptance', async () => {
    const onResponseAccepted = vi.fn()
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'terminal.read') {
        return { ok: true, result: { terminal: { lines: HIGHLIGHTED_OPTION_3_SCREEN, source: 'screen' } } }
      }
      return { ok: true, result: { send: { accepted: true } } }
    })
    function Harness(): null {
      respond = useMobileNativeChatPlanFeedbackSend({
        client: { getState: () => 'connected', sendRequest } as unknown as RpcClient,
        enabled: true,
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: null },
        onSendError: vi.fn(),
        onResponseAccepted
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })

    await act(async () => {
      await expect(respond?.('3', 'Use two sentences instead.')).resolves.toBe(true)
    })
    expect(sendRequest).toHaveBeenCalledTimes(3)
    expect(onResponseAccepted).toHaveBeenCalledOnce()
  })

  it('surfaces the terminal-typing refusal message, not a generic failure', async () => {
    const onSendError = vi.fn()
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'terminal.read') {
        // Still on option 1 — the navigate write never landed as far as the screen shows.
        return {
          ok: true,
          result: {
            terminal: {
              lines: [
                '   ❯ 1. Yes, and use auto mode',
                '     2. Yes, manually approve edits',
                '     3. Tell Claude what to change'
              ],
              source: 'screen'
            }
          }
        }
      }
      return { ok: true, result: { send: { accepted: true } } }
    })
    function Harness(): null {
      respond = useMobileNativeChatPlanFeedbackSend({
        client: { getState: () => 'connected', sendRequest } as unknown as RpcClient,
        enabled: true,
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: null },
        onSendError
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })

    await act(async () => {
      await expect(respond?.('3', 'Use two sentences instead.')).resolves.toBe(false)
    })
    expect(onSendError).toHaveBeenCalledWith("Couldn't hand the comment over — type it in the terminal")
  })

  it('rejects while another composed write holds the terminal, then recovers', async () => {
    const onSendError = vi.fn()
    const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: true } } })
    function Harness(): null {
      respond = useMobileNativeChatPlanFeedbackSend({
        client: { getState: () => 'connected', sendRequest } as unknown as RpcClient,
        enabled: true,
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: null },
        onSendError
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })

    expect(acquireMobileNativeChatTerminalWrite('terminal')).toBe(true)
    await act(async () => {
      await expect(respond?.('3', '')).resolves.toBe(false)
    })
    expect(sendRequest).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith('Response not sent')

    releaseMobileNativeChatTerminalWrite('terminal')
    await act(async () => {
      await expect(respond?.('3', '')).resolves.toBe(true)
    })
    // The composed write released its own hold on the way out.
    expect(acquireMobileNativeChatTerminalWrite('terminal')).toBe(true)
    releaseMobileNativeChatTerminalWrite('terminal')
  })

  it('is a no-op when disabled — the structured lane, which never calls this', async () => {
    const onSendError = vi.fn()
    const sendRequest = vi.fn()
    function Harness(): null {
      respond = useMobileNativeChatPlanFeedbackSend({
        client: { sendRequest } as unknown as RpcClient,
        enabled: false,
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: null },
        onSendError
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await expect(respond?.('3', 'Use two sentences instead.')).resolves.toBe(false)
    })
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
