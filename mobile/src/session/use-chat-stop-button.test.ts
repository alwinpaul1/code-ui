import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  STOP_STILL_WORKING_MESSAGE,
  STOP_STILL_WORKING_MS,
  useChatStopButton
} from './use-chat-stop-button'
import { useMobileNativeChatStop } from './use-mobile-native-chat-stop'

// The Claude app (1.261009.20) draws a ring round Stop while it is stopping and
// swallows repeat taps (yv8.i -> bsh.Interrupting, sg4's 36 dp ring, the null
// check on sessions.store.a.n); when the interrupt fails the ring goes and a
// snackbar says "Couldn't stop the session. Try again." (parity gap G24). Code
// UI's Stop is a pair of Escapes and used to fire and forget: a Stop the agent
// ignored left a button that looked the same as before the tap.

afterEach(() => {
  vi.useRealTimers()
})

describe('a Stop tap reports whether the agent took it', () => {
  let renderer: ReactTestRenderer | null = null
  let stop: (() => Promise<boolean>) | null = null
  const onSendError = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    onSendError.mockReset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function mount(sendRequest: ReturnType<typeof vi.fn>, handle: string | null = 'terminal'): Promise<void> {
    function Harness(): null {
      stop = useMobileNativeChatStop({
        client: { sendRequest } as unknown as RpcClient,
        enabled: true,
        handleRef: { current: handle },
        deviceTokenRef: { current: 'device' },
        streamIdentity: 'route',
        agent: 'claude',
        cancelPending: () => undefined,
        onSendError
      })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
  }

  async function tap(): Promise<boolean> {
    let verdict!: Promise<boolean>
    await act(async () => {
      verdict = stop!()
      await vi.runAllTimersAsync()
    })
    return verdict
  }

  it('resolves true once an Escape was accepted', async () => {
    await mount(vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: true } } }))
    await expect(tap()).resolves.toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('resolves false, after saying so, when both Escapes were refused', async () => {
    await mount(vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: false } } }))
    await expect(tap()).resolves.toBe(false)
    expect(onSendError).toHaveBeenCalledWith('Stop not sent')
  })

  it('resolves false when there is no terminal to stop', async () => {
    await mount(vi.fn(), null)
    await expect(tap()).resolves.toBe(false)
    expect(onSendError).toHaveBeenCalledWith('Stop not sent (terminal not ready)')
  })
})

describe('the Stop button while a stop is under way', () => {
  let renderer: ReactTestRenderer | null = null
  let button: ReturnType<typeof useChatStopButton> | null = null
  const onSendError = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    onSendError.mockReset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    button = null
  })

  function Harness(props: { stop: () => Promise<boolean> | void; canStop: boolean; scope?: string }): null {
    button = useChatStopButton({ ...props, scope: props.scope ?? 'tab', onSendError })
    return null
  }
  async function render(props: { stop: () => Promise<boolean> | void; canStop: boolean; scope?: string }): Promise<void> {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, props))
      } else {
        renderer = create(createElement(Harness, props))
      }
    })
  }

  it('shows it is stopping on the tap and takes no second tap while it waits', async () => {
    const stop = vi.fn(() => new Promise<boolean>(() => {}))
    await render({ stop, canStop: true })
    expect(button!.stopping).toBe(false)
    await act(async () => button!.onStop())
    expect(button!.stopping).toBe(true)
    await act(async () => button!.onStop())
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('comes back at once when the lane says the stop did not go', async () => {
    await render({ stop: () => Promise.resolve(false), canStop: true })
    await act(async () => button!.onStop())
    expect(button!.stopping).toBe(false)
    // The lane already said why ("Stop not sent"); a second line would repeat it.
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('comes back and says so when the agent is still working after the stop went', async () => {
    await render({ stop: () => Promise.resolve(true), canStop: true })
    await act(async () => button!.onStop())
    expect(button!.stopping).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS - 1))
    expect(button!.stopping).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(button!.stopping).toBe(false)
    expect(onSendError).toHaveBeenCalledWith(STOP_STILL_WORKING_MESSAGE)
  })

  it('treats a lane that answers nothing (the structured cancel) as sent', async () => {
    await render({ stop: () => undefined, canStop: true })
    await act(async () => button!.onStop())
    expect(button!.stopping).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS))
    expect(onSendError).toHaveBeenCalledWith(STOP_STILL_WORKING_MESSAGE)
  })

  it('stands down quietly when the turn ends', async () => {
    const stop = () => Promise.resolve(true)
    await render({ stop, canStop: true })
    await act(async () => button!.onStop())
    await render({ stop, canStop: false })
    expect(button!.stopping).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS * 2))
    expect(onSendError).not.toHaveBeenCalled()
    // The next turn starts with a live button.
    await render({ stop, canStop: true })
    expect(button!.stopping).toBe(false)
  })

  it('does not carry a stop over to another tab', async () => {
    const stop = () => Promise.resolve(true)
    await render({ stop, canStop: true, scope: 'tab-a' })
    await act(async () => button!.onStop())
    await render({ stop, canStop: true, scope: 'tab-b' })
    expect(button!.stopping).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS * 2))
    expect(onSendError).not.toHaveBeenCalled()
  })
})
