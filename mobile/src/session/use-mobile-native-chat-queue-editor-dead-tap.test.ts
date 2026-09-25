import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { useMobileNativeChatQueueEditor } from './use-mobile-native-chat-queue-editor'

type QueueEditor = ReturnType<typeof useMobileNativeChatQueueEditor>

/**
 * The queue box draws "Send now" and a pencil on every row whatever the
 * connection is doing, so a tap the hook turns away without a word is a dead
 * button: nothing happens, and nothing says why. Found by the sweep that
 * followed the Stop fix (2026-09-25): both returned early, silently, when the
 * chat was disconnected or had no terminal yet, and "Send now" did the same
 * while an edit was still being written.
 */
describe('a queue tap that did nothing says so', () => {
  let renderer: ReactTestRenderer | null = null
  let queue: QueueEditor | null = null
  let onError = vi.fn()
  let sendRequest = vi.fn()

  beforeEach(() => {
    onError = vi.fn()
    sendRequest = vi.fn(async () => ({ ok: true, result: { send: { accepted: true } } }))
    resetMobileNativeChatTerminalWritesForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    queue = null
  })

  function Harness({
    enabled,
    handle,
    beforeOpen
  }: {
    enabled: boolean
    handle: string | null
    beforeOpen: () => Promise<void>
  }): null {
    queue = useMobileNativeChatQueueEditor({
      agent: 'claude',
      tabId: 'tab',
      handleRef: { current: handle },
      deviceTokenRef: { current: 'phone' },
      client: { sendRequest, getState: () => 'connected' } as unknown as RpcClient,
      enabled,
      beforeOpen,
      onError,
      pending: [],
      removePending: vi.fn(),
      queued: ['first queued', 'second queued']
    })
    return null
  }

  async function mount(props: {
    enabled: boolean
    handle: string | null
    beforeOpen?: () => Promise<void>
  }): Promise<void> {
    await act(async () => {
      renderer = create(
        createElement(Harness, { beforeOpen: async () => undefined, ...props })
      )
    })
  }

  it('says the queue was not sent when Send now is tapped while disconnected', async () => {
    await mount({ enabled: false, handle: 'terminal' })

    let sent: boolean | undefined
    await act(async () => {
      sent = await queue?.sendNow()
    })

    expect(sent).toBe(false)
    expect(sendRequest).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('Queued messages not sent (disconnected)')
  })

  it('says the queue was not sent when Send now is tapped before the chat has a terminal', async () => {
    await mount({ enabled: true, handle: null })

    let sent: boolean | undefined
    await act(async () => {
      sent = await queue?.sendNow()
    })

    expect(sent).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('Queued messages not sent (terminal not ready)')
  })

  it('says the queue was not sent when Send now is tapped while an edit is still being written', async () => {
    let finishOpening!: () => void
    await mount({
      enabled: true,
      handle: 'terminal',
      beforeOpen: () =>
        new Promise<void>((resolve) => {
          finishOpening = resolve
        })
    })
    // The pencil's recall is on its way to the agent.
    act(() => {
      void queue?.open(0, 'first queued')
    })

    let sent: boolean | undefined
    await act(async () => {
      sent = await queue?.sendNow()
    })

    expect(sent).toBe(false)
    expect(sendRequest).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('Another input is still being sent. Try again.')
    // Let the recall finish on a queue read that refuses, so nothing is left in flight.
    sendRequest.mockResolvedValue({ ok: false, error: { code: 'x', message: 'x' } })
    await act(async () => {
      finishOpening()
      await Promise.resolve()
    })
  })

  it('says the queue editor did not open when the pencil is tapped while disconnected', async () => {
    await mount({ enabled: false, handle: 'terminal' })

    await act(async () => {
      await queue?.open(1, 'second queued')
    })

    expect(queue?.editor).toBeNull()
    expect(sendRequest).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('Could not open the queue editor (disconnected).')
  })

  it('says the queue editor did not open when the chat has no terminal yet', async () => {
    await mount({ enabled: true, handle: null })

    await act(async () => {
      await queue?.open(1, 'second queued')
    })

    expect(queue?.editor).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('Could not open the queue editor (terminal not ready).')
  })

  it('leaves a second pencil tap to the recall the first one started', async () => {
    let finishOpening!: () => void
    await mount({
      enabled: true,
      handle: 'terminal',
      beforeOpen: () =>
        new Promise<void>((resolve) => {
          finishOpening = resolve
        })
    })

    act(() => {
      void queue?.open(0, 'first queued')
    })
    await act(async () => {
      await queue?.open(0, 'first queued')
    })

    // The first tap's recall answers for both; the second says nothing.
    expect(onError).not.toHaveBeenCalled()
    sendRequest.mockResolvedValue({ ok: false, error: { code: 'x', message: 'x' } })
    await act(async () => {
      finishOpening()
      await Promise.resolve()
    })
  })
})
