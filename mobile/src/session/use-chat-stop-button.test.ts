import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
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
  let stop: ((onVerdict?: (sent: boolean) => void) => void) | null = null
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

  /** The verdicts one tap reported: exactly one, once its keys have settled. */
  async function tap(): Promise<boolean[]> {
    const verdicts: boolean[] = []
    await act(async () => {
      stop!((sent) => verdicts.push(sent))
      await vi.runAllTimersAsync()
    })
    return verdicts
  }

  it('reports true once an Escape was accepted', async () => {
    await mount(vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: true } } }))
    expect(await tap()).toEqual([true])
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('reports false, after saying so, when both Escapes were refused', async () => {
    await mount(vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: false } } }))
    expect(await tap()).toEqual([false])
    expect(onSendError).toHaveBeenCalledWith("Couldn't stop the session. Try again.")
  })

  it('reports false when there is no terminal to stop', async () => {
    await mount(vi.fn(), null)
    expect(await tap()).toEqual([false])
    expect(onSendError).toHaveBeenCalledWith("Couldn't stop the session. Try again.")
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

  type Lane = { stop: (onVerdict: (sent: boolean) => void) => void; reportsVerdict?: boolean; canStop: boolean; scope?: string }
  function Harness(props: Lane): null {
    button = useChatStopButton({ ...props, reportsVerdict: props.reportsVerdict ?? true, scope: props.scope ?? 'tab', onSendError })
    return null
  }
  async function render(props: Lane): Promise<void> {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, props))
      } else {
        renderer = create(createElement(Harness, props))
      }
    })
  }

  it('shows it is stopping on the tap and takes no second tap while it waits', async () => {
    const stop = vi.fn()
    await render({ stop, canStop: true })
    expect(button!.stopping).toBe(false)
    await act(async () => button!.onStop())
    expect(button!.stopping).toBe(true)
    await act(async () => button!.onStop())
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('comes back at once when the lane says the stop did not go', async () => {
    await render({ stop: (verdict) => verdict(false), canStop: true })
    await act(async () => button!.onStop())
    expect(button!.stopping).toBe(false)
    // The lane already said so ("Couldn't stop the session"); a second line would repeat it.
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('comes back and says so when the agent is still working after the stop went', async () => {
    await render({ stop: (verdict) => verdict(true), canStop: true })
    await act(async () => button!.onStop())
    expect(button!.stopping).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS - 1) })
    expect(button!.stopping).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(button!.stopping).toBe(false)
    expect(onSendError).toHaveBeenCalledWith("Couldn't stop the session. Try again.")
  })

  it('treats a lane that answers nothing (the structured cancel) as sent', async () => {
    await render({ stop: () => undefined, reportsVerdict: false, canStop: true })
    await act(async () => button!.onStop())
    expect(button!.stopping).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS) })
    expect(onSendError).toHaveBeenCalledWith("Couldn't stop the session. Try again.")
  })

  it('stands down quietly when the turn ends', async () => {
    const stop = (verdict: (sent: boolean) => void) => verdict(true)
    await render({ stop, canStop: true })
    await act(async () => button!.onStop())
    await render({ stop, canStop: false })
    expect(button!.stopping).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS * 2) })
    expect(onSendError).not.toHaveBeenCalled()
    // The next turn starts with a live button.
    await render({ stop, canStop: true })
    expect(button!.stopping).toBe(false)
  })

  it('does not carry a stop over to another tab', async () => {
    const stop = (verdict: (sent: boolean) => void) => verdict(true)
    await render({ stop, canStop: true, scope: 'tab-a' })
    await act(async () => button!.onStop())
    await render({ stop, canStop: true, scope: 'tab-b' })
    expect(button!.stopping).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS * 2) })
    expect(onSendError).not.toHaveBeenCalled()
  })
})
