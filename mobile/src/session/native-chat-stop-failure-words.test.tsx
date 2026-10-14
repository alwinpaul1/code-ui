import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { requestMobileStructuredAgentSessionCancel } from './mobile-structured-agent-session-cancel'
import { STOP_STILL_WORKING_MS, useChatStopButton } from './use-chat-stop-button'
import { useMobileNativeChatStop } from './use-mobile-native-chat-stop'

// G24 (docs/claude-app-parity-gaps.md): "a Stop that fails shows 'Couldn't stop the
// session. Try again.' and re-enables Stop." The Claude app says exactly that when its
// interrupt fails (1.261009.20, `ccr_stop_session_failed`). Code UI already took the ring
// off and re-enabled Stop on a failure, but said it three ways ("Stop not sent", "Stop not
// sent (terminal not ready)", "The agent is still working after Stop. Try again."), and the
// structured lane said a fourth. The words below are literals on purpose: a test that
// imports the constant would pass whatever the constant says.
//
// What stays different: an ack lost AFTER the Escape was written may still have stopped the
// agent, so "Couldn't stop" would be a claim nobody can back, and it would invite a second
// Escape into changed state. That one keeps its own, cautious line.
const COULDNT_STOP = "Couldn't stop the session. Try again."
const UNCONFIRMED = 'Stop unconfirmed — check chat before retrying'

describe('a Stop that fails says it could not stop, and Stop is live again', () => {
  let renderer: ReactTestRenderer | null = null
  let button: ReturnType<typeof useChatStopButton> | null = null
  let sendRequest = vi.fn()
  let handle: string | null = 'terminal'
  const onSendError = vi.fn()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  beforeEach(() => {
    vi.useFakeTimers()
    onSendError.mockReset()
    warn.mockClear()
    handle = 'terminal'
    sendRequest = vi.fn()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    button = null
    vi.useRealTimers()
  })

  // The chain the controller builds (use-mobile-native-chat-controller.ts): the terminal
  // lane's two Escapes behind the button that rings and re-enables.
  function Harness(): null {
    const stop = useMobileNativeChatStop({
      client: { sendRequest } as unknown as RpcClient,
      enabled: true,
      handleRef: { current: handle },
      deviceTokenRef: { current: 'device' },
      streamIdentity: 'route',
      agent: 'claude',
      cancelPending: () => undefined,
      onSendError
    })
    button = useChatStopButton({ stop, reportsVerdict: true, canStop: true, scope: 'route', onSendError })
    return null
  }

  async function tapStop(): Promise<void> {
    if (!renderer) {
      await act(async () => {
        renderer = create(createElement(Harness))
      })
    }
    // Past the 80 ms between the two Escapes, short of the 10 s the button waits for the turn to end.
    await act(async () => {
      button!.onStop()
      await vi.advanceTimersByTimeAsync(200)
    })
  }

  it.each([
    ['the host refuses both Escapes', () => vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: false } } })],
    ['the host answers with an error', () => vi.fn().mockResolvedValue({ ok: false, error: { code: 'stale', message: 'stale' } })],
    ['the request is rejected outright', () => vi.fn().mockRejectedValue(new Error('disconnected'))]
  ])('when %s', async (_case, makeRequest) => {
    sendRequest = makeRequest()
    await tapStop()

    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith(COULDNT_STOP)
    // Stop is live again: no ring, and the next tap goes out instead of being swallowed.
    expect(button!.stopping).toBe(false)
    const sentBefore = sendRequest.mock.calls.length
    await tapStop()
    expect(sendRequest.mock.calls.length).toBeGreaterThan(sentBefore)
  })

  it('when the tab has no terminal to stop', async () => {
    handle = null
    await tapStop()

    expect(onSendError).toHaveBeenCalledWith(COULDNT_STOP)
    expect(button!.stopping).toBe(false)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('when the agent still works after the Escapes went', async () => {
    sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: true } } })
    await tapStop()
    expect(button!.stopping).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS)
    })

    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith(COULDNT_STOP)
    expect(button!.stopping).toBe(false)
  })

  it('does not claim a failure when the ack was lost after the Escape was written', async () => {
    sendRequest = vi.fn().mockRejectedValue(markRpcDeliveryUnknown(new Error('rpc timeout')))
    await tapStop()

    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith(UNCONFIRMED)
    expect(button!.stopping).toBe(false)
  })

  // CLAUDE.md rule 9: the words are the Claude app's, so the cause moves to the log. A Stop
  // that failed while nobody watched must leave one line that says where to look.
  it.each([
    ['the host refuses both Escapes', () => vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: false } } }), /host did not accept/i],
    ['the request is rejected outright', () => vi.fn().mockRejectedValue(new Error('disconnected')), /disconnected/]
  ])('logs why when %s', async (_case, makeRequest, cause) => {
    sendRequest = makeRequest()
    await tapStop()

    const lines = warn.mock.calls.map((call) => String(call[0]))
    expect(lines.filter((line) => line.startsWith('[stop]'))).toHaveLength(1)
    expect(lines.find((line) => line.startsWith('[stop]'))).toMatch(cause)
  })

  it('logs that no terminal was there to stop', async () => {
    handle = null
    await tapStop()

    expect(warn.mock.calls.map((call) => String(call[0])).find((line) => line.startsWith('[stop]'))).toMatch(
      /no terminal/i
    )
  })

  it('logs that the agent was still working when the ring timed out', async () => {
    sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: true } } })
    await tapStop()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS)
    })

    expect(warn.mock.calls.map((call) => String(call[0])).find((line) => line.startsWith('[stop]'))).toMatch(
      /still working/i
    )
  })

  it('logs nothing when the Stop worked', async () => {
    sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { send: { accepted: true } } })
    await tapStop()
    // The turn ending on its own is the end of a good stop; the button stands down.
    act(() => renderer?.unmount())
    renderer = null

    expect(warn.mock.calls.filter((call) => String(call[0]).startsWith('[stop]'))).toHaveLength(0)
  })
})

describe('the structured lane says the same words when its Stop fails', () => {
  const onSendError = vi.fn()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  let renderer: ReactTestRenderer | null = null
  let button: ReturnType<typeof useChatStopButton> | null = null
  beforeEach(() => {
    vi.useFakeTimers()
    onSendError.mockReset()
    warn.mockClear()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    button = null
    vi.useRealTimers()
  })

  function cancel(over: Partial<Parameters<typeof requestMobileStructuredAgentSessionCancel>[0]>): Promise<boolean> {
    return requestMobileStructuredAgentSessionCancel({
      client: null,
      sessionId: 'session-1',
      enabled: true,
      stateRef: { current: { items: [], fence: null } as never },
      promptCancelSupported: null,
      hostAnswersRepeatedStops: null,
      inFlight: new Map(),
      onSendError,
      ...over
    })
  }
  const stopLines = (): string[] =>
    warn.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[stop]'))

  it('when there is no client to stop with', async () => {
    expect(await cancel({})).toBe(false)
    expect(onSendError).toHaveBeenCalledWith(COULDNT_STOP)
    expect(stopLines()).toHaveLength(1)
    expect(stopLines()[0]).toMatch(/no client/)
  })

  it('when the session is not enabled, with a client in hand', async () => {
    expect(await cancel({ client: {} as RpcClient, enabled: false })).toBe(false)
    expect(onSendError).toHaveBeenCalledWith(COULDNT_STOP)
    expect(stopLines()[0]).toMatch(/not enabled/)
  })

  // The structured lane reports no verdict to the button (its cancel is fire and forget), so a
  // refused cancel left the 10 s watch armed: the chat said "Couldn't stop" at the tap and, the
  // turn still showing, again ten seconds later, with a second `[stop]` line that claimed a
  // Stop had gone out when none had. A cancel that settles false has already said why.
  function mountStructuredButton(stop: () => Promise<boolean>): void {
    function Harness(): null {
      button = useChatStopButton({ stop, reportsVerdict: false, canStop: true, scope: 'structured', onSendError })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
  }

  it('says it once, at the tap, and not again ten seconds later', async () => {
    mountStructuredButton(() => cancel({}))
    await act(async () => {
      button!.onStop()
      await vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS * 2)
    })

    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith(COULDNT_STOP)
    expect(stopLines()).toHaveLength(1)
    expect(button!.stopping).toBe(false)
  })

  it('still watches a cancel the host accepted, and says so if the turn is still running', async () => {
    mountStructuredButton(() => Promise.resolve(true))
    await act(async () => {
      button!.onStop()
      await vi.advanceTimersByTimeAsync(STOP_STILL_WORKING_MS - 1)
    })
    expect(button!.stopping).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(onSendError).toHaveBeenCalledTimes(1)
    expect(onSendError).toHaveBeenCalledWith(COULDNT_STOP)
    expect(button!.stopping).toBe(false)
  })
})
