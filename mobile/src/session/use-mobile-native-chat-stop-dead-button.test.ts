import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { useMobileNativeChatStop } from './use-mobile-native-chat-stop'

function reply(accepted: boolean) {
  return {
    id: 'send',
    ok: true as const,
    result: { send: { accepted } },
    _meta: { runtimeId: 'r' }
  }
}

const ROUTE = 'host\0worktree\0tab\0session\0terminal'
const ANOTHER_TAB = 'host\0worktree\0other-tab\0other\0other-terminal'

/**
 * The Stop button stays up for as long as the agent works, so a Stop whose
 * Escape the host refused, and that says nothing, is a dead button: it reads
 * the same as a slow one, and the agent keeps going. The verdict used to be
 * gated on a counter that a dropped input lease, a reconnect, a tab switch and
 * an unmount all bump as well as a newer Stop, so every one of those silenced
 * it (flagged on 2026-09-25 beside the ask-answer fix, 5621c218). Only a newer
 * Stop takes the verdict away: it reports for itself. Where the words land
 * (banner, or a toast once the chat has moved on) is
 * `use-mobile-native-chat-send-error.ts`'s call.
 */
describe('a Stop tap that did nothing says so', () => {
  let renderer: ReactTestRenderer | null = null
  let stop: (() => void) | null = null
  let mountedClient: RpcClient | null = null
  let mountedAgent: string | null = null
  let onSendError = vi.fn()

  beforeEach(() => {
    onSendError = vi.fn()
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    stop = null
    mountedClient = null
    mountedAgent = null
    vi.useRealTimers()
  })

  function Harness({ enabled, streamIdentity }: { enabled: boolean; streamIdentity: string }): null {
    stop = useMobileNativeChatStop({
      client: mountedClient,
      enabled,
      handleRef: { current: 'terminal' },
      deviceTokenRef: { current: 'device' },
      streamIdentity,
      agent: mountedAgent,
      cancelPending: () => undefined,
      onSendError
    })
    return null
  }

  async function mount(client: RpcClient, agent: string | null = 'claude'): Promise<void> {
    mountedClient = client
    mountedAgent = agent
    await act(async () => {
      renderer = create(createElement(Harness, { enabled: true, streamIdentity: ROUTE }))
    })
  }

  async function rerender(props: { enabled: boolean; streamIdentity: string }): Promise<void> {
    await act(async () => {
      renderer?.update(createElement(Harness, props))
    })
  }

  /** A send whose reply the test settles by hand, in call order. */
  function heldSends() {
    const settle: Array<(value: unknown) => void> = []
    const fail: Array<(error: Error) => void> = []
    const sendRequest = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          settle.push(resolve)
          fail.push(reject)
        })
    )
    return { sendRequest, settle, fail }
  }

  async function settleAll(run: () => void = () => undefined): Promise<void> {
    await act(async () => {
      run()
      await Promise.resolve()
      await vi.runAllTimersAsync()
    })
  }

  it('says Stop was not sent when the input lease drops under its refused Escape', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    act(() => stop?.())
    expect(sendRequest).toHaveBeenCalledTimes(1)
    // The phone loses the input floor while the Escape is on the wire, which
    // also cancels the paced second one, and the host refuses the first.
    await rerender({ enabled: false, streamIdentity: ROUTE })
    await settleAll(() => settle[0]!(reply(false)))

    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop not sent')
  })

  it('says Stop is unconfirmed when the lease drops under an Escape whose ack is lost', async () => {
    const { sendRequest, fail } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    act(() => stop?.())
    await rerender({ enabled: false, streamIdentity: ROUTE })
    await settleAll(() => fail[0]!(markRpcDeliveryUnknown(new Error('Connection closed'))))

    // The Escape may have landed; a definite "not sent" invites a second one.
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop unconfirmed — check chat before retrying')
  })

  it('says Stop was not sent when its first Escape was refused before the lease dropped', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    act(() => stop?.())
    await act(async () => {
      settle[0]!(reply(false))
      await Promise.resolve()
    })
    // Inside the 80 ms pacing gap: the second Escape is dropped, never sent.
    await rerender({ enabled: false, streamIdentity: ROUTE })
    await settleAll()

    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop not sent')
  })

  it("says Grok's Ctrl+C was not sent when the lease drops under it", async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient, 'grok')

    act(() => stop?.())
    await rerender({ enabled: false, streamIdentity: ROUTE })
    await settleAll(() => settle[0]!(reply(false)))

    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop not sent')
  })

  it('still reports a Stop the chat has moved away from, for the toast to carry', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    act(() => stop?.())
    await rerender({ enabled: true, streamIdentity: ANOTHER_TAB })
    await settleAll(() => settle[0]!(reply(false)))

    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop not sent')
  })

  it('still reports a Stop whose chat closed before the host answered', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    act(() => stop?.())
    act(() => renderer?.unmount())
    renderer = null
    await settleAll(() => settle[0]!(reply(false)))

    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop not sent')
  })

  it('says Stop was not sent when the tap lands on a callback from before the lease dropped', async () => {
    const { sendRequest } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)
    const earlierStop = stop

    await rerender({ enabled: false, streamIdentity: ROUTE })
    act(() => earlierStop?.())
    await settleAll()

    // Nothing was written, so nothing is left to report it but this.
    expect(sendRequest).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop not sent')
  })

  // Second review (2026-09-25): Claude's verdict came from its 80 ms timer;
  // Grok sends one Ctrl+C and has no timer, so the same tap said nothing.
  it("says Grok's Stop was not sent when the tap lands on a callback from before the lease dropped", async () => {
    const { sendRequest } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient, 'grok')
    const earlierStop = stop

    await rerender({ enabled: false, streamIdentity: ROUTE })
    act(() => earlierStop?.())
    await settleAll()

    expect(sendRequest).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop not sent')
  })

  // Second review (2026-09-25): a tap turned away before it wrote anything is
  // still the newest Stop, and it has already said why.
  it('says it once when a second Stop is turned away while the first is still on the wire', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    act(() => stop?.())
    await rerender({ enabled: false, streamIdentity: ROUTE })
    act(() => stop?.())
    await settleAll(() => settle[0]!(reply(false)))

    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop not sent (terminal not ready)')
  })

  it('stays quiet when the lease drops after an Escape landed', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    act(() => stop?.())
    await rerender({ enabled: false, streamIdentity: ROUTE })
    await settleAll(() => settle[0]!(reply(true)))

    expect(onSendError).not.toHaveBeenCalled()
  })

  it('says it once when a newer Stop that took over fails too', async () => {
    const { sendRequest, settle } = heldSends()
    await mount({ sendRequest } as unknown as RpcClient)

    act(() => stop?.())
    act(() => stop?.())
    await settleAll(() => {
      for (const resolve of settle) {
        resolve(reply(false))
      }
    })
    await settleAll(() => {
      for (const resolve of settle) {
        resolve(reply(false))
      }
    })

    // The first tap's Escape and the second tap's two Escapes all went out.
    expect(sendRequest).toHaveBeenCalledTimes(3)
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith('Stop not sent')
  })
})
