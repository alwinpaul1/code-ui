import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatPlanFeedbackRespond } from './use-mobile-native-chat-plan-feedback-respond'

describe('useMobileNativeChatPlanFeedbackRespond', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    resetMobileNativeChatTerminalWritesForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('is undefined in the structured lane — the comment sheet button never appears', () => {
    let respond: unknown
    function Harness(): null {
      respond = useMobileNativeChatPlanFeedbackRespond({
        client: { getState: () => 'connected', sendRequest: vi.fn() } as unknown as RpcClient,
        enabled: true,
        structured: true,
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: null },
        onSendError: vi.fn(),
        onResponseAccepted: vi.fn(),
        onAccepted: vi.fn()
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    expect(respond).toBeUndefined()
  })

  it('sends and retires the held failure banner on acceptance in the TUI lane', async () => {
    const onAccepted = vi.fn()
    const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: true } } })
    let respond: ((send: string, comment: string) => Promise<boolean>) | undefined
    function Harness(): null {
      respond = useMobileNativeChatPlanFeedbackRespond({
        client: { getState: () => 'connected', sendRequest } as unknown as RpcClient,
        enabled: true,
        structured: false,
        handleRef: { current: 'terminal' },
        deviceTokenRef: { current: null },
        onSendError: vi.fn(),
        onResponseAccepted: vi.fn(),
        onAccepted
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    expect(respond).toBeDefined()
    await act(async () => {
      await expect(respond?.('3', '')).resolves.toBe(true)
    })
    expect(onAccepted).toHaveBeenCalledOnce()
  })
})
