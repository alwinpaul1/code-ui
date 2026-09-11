import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVENESS_IDLE_MS,
  LIVENESS_PROBE_TIMEOUT_MS,
  RpcSessionLivenessWatchdog
} from './rpc-session-liveness-watchdog'

describe('RpcSessionLivenessWatchdog', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function fixture() {
    const sendProbe = vi.fn(() => true)
    const terminate = vi.fn()
    const watchdog = new RpcSessionLivenessWatchdog({
      transport: 'direct',
      sendProbe,
      terminate,
      now: Date.now
    })
    const identity = {}
    watchdog.start(identity)
    return { identity, sendProbe, terminate, watchdog }
  }

  it('probes only after authenticated-inbound idle', async () => {
    const { identity, sendProbe, watchdog } = fixture()
    await vi.advanceTimersByTimeAsync(LIVENESS_IDLE_MS - 1)
    expect(sendProbe).not.toHaveBeenCalled()

    watchdog.noteAuthenticatedInbound(identity)
    await vi.advanceTimersByTimeAsync(LIVENESS_IDLE_MS - 1)
    expect(sendProbe).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(sendProbe).toHaveBeenCalledOnce()
  })

  it('requires three fair consecutive misses', async () => {
    const { identity, terminate, watchdog } = fixture()
    watchdog.probeNow(identity)

    await vi.advanceTimersByTimeAsync(LIVENESS_PROBE_TIMEOUT_MS * 2)
    expect(terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(LIVENESS_PROBE_TIMEOUT_MS)
    expect(terminate).toHaveBeenCalledOnce()
    expect(terminate).toHaveBeenCalledWith(identity)
  })

  it('reports causal evidence before terminating a stale session', async () => {
    const onTimeout = vi.fn()
    const terminate = vi.fn()
    const identity = {}
    const watchdog = new RpcSessionLivenessWatchdog({
      transport: 'relay',
      idleProbeMs: null,
      probeTimeoutMs: 4_000,
      missedProbeLimit: 2,
      sendProbe: () => true,
      terminate,
      onTimeout,
      now: Date.now
    })
    watchdog.start(identity)
    watchdog.probeNow(identity)

    await vi.advanceTimersByTimeAsync(8_000)

    expect(onTimeout).toHaveBeenCalledWith({
      transport: 'relay',
      reason: 'probe-timeout',
      missedProbes: 2,
      missedProbeLimit: 2,
      lastInboundAgeMs: 8_000
    })
    expect(onTimeout.mock.invocationCallOrder[0]).toBeLessThan(
      terminate.mock.invocationCallOrder[0]!
    )
  })

  it('authenticated activity resets suspicion', async () => {
    const { identity, terminate, watchdog } = fixture()
    watchdog.probeNow(identity)
    await vi.advanceTimersByTimeAsync(LIVENESS_PROBE_TIMEOUT_MS)
    watchdog.noteAuthenticatedInbound(identity)
    await vi.advanceTimersByTimeAsync(LIVENESS_IDLE_MS + LIVENESS_PROBE_TIMEOUT_MS * 2)
    expect(terminate).not.toHaveBeenCalled()
  })

  it('does not churn timers during continuous authenticated traffic', async () => {
    const setTimer = vi.fn(setTimeout)
    const sendProbe = vi.fn(() => true)
    const watchdog = new RpcSessionLivenessWatchdog({
      transport: 'direct',
      sendProbe,
      terminate: vi.fn(),
      now: Date.now,
      setTimer
    })
    const identity = {}
    watchdog.start(identity)

    await vi.advanceTimersByTimeAsync(10_000)
    for (let index = 0; index < 100; index++) {
      watchdog.noteAuthenticatedInbound(identity)
    }
    expect(setTimer).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(sendProbe).not.toHaveBeenCalled()
    expect(setTimer).toHaveBeenCalledTimes(2)
  })

  it('does not charge a scheduler-stalled probe window', () => {
    let now = 0
    let callback: (() => void) | null = null
    const terminate = vi.fn()
    const watchdog = new RpcSessionLivenessWatchdog({
      transport: 'relay',
      idleProbeMs: null,
      probeTimeoutMs: 4_000,
      missedProbeLimit: 2,
      sendProbe: () => true,
      terminate,
      now: () => now,
      setTimer: (next) => {
        callback = next
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => {}
    })
    const identity = {}
    watchdog.start(identity)
    watchdog.probeNow(identity)
    now = 8_000
    callback?.()
    now += 4_000
    callback?.()
    expect(terminate).not.toHaveBeenCalled()
  })

  it('invalidates late callbacks after identity replacement', () => {
    const callbacks: (() => void)[] = []
    const terminate = vi.fn()
    const watchdog = new RpcSessionLivenessWatchdog({
      transport: 'direct',
      sendProbe: () => true,
      terminate,
      now: () => 0,
      setTimer: (callback) => {
        callbacks.push(callback)
        return callbacks.length as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => {}
    })
    const first = {}
    const replacement = {}
    watchdog.start(first)
    watchdog.probeNow(first)
    watchdog.start(replacement)
    callbacks.forEach((callback) => callback())
    expect(terminate).not.toHaveBeenCalled()
  })

  it('terminates immediately when a probe cannot be written', () => {
    const terminate = vi.fn()
    const identity = {}
    const watchdog = new RpcSessionLivenessWatchdog({
      transport: 'direct',
      sendProbe: () => false,
      terminate
    })
    watchdog.start(identity)
    watchdog.probeNow(identity)
    expect(terminate).toHaveBeenCalledWith(identity)
  })

  describe('what the header can know about the probe', () => {
    it('reports probing from the moment a probe is sent until an answer arrives', async () => {
      const { identity, sendProbe, watchdog } = fixture()
      expect(watchdog.isProbing()).toBe(false)
      watchdog.noteAuthenticatedInbound(identity)
      await vi.advanceTimersByTimeAsync(LIVENESS_IDLE_MS)
      expect(sendProbe).toHaveBeenCalledOnce()
      expect(watchdog.isProbing()).toBe(true)

      watchdog.noteAuthenticatedInbound(identity)
      expect(watchdog.isProbing()).toBe(false)
    })

    it('tells a listener when probing starts and stops', async () => {
      const { identity, watchdog } = fixture()
      const seen: boolean[] = []
      watchdog.onProbingChange((probing) => seen.push(probing))
      watchdog.noteAuthenticatedInbound(identity)
      await vi.advanceTimersByTimeAsync(LIVENESS_IDLE_MS)
      watchdog.noteAuthenticatedInbound(identity)
      expect(seen).toEqual([true, false])
    })
  })

  describe('a shorter leash while the user is looking', () => {
    /** Relay idle probe 30 s + 4 s timeout × 2 misses = 38 s to notice a dead
     *  socket. Backgrounded that is the right economy (a relay probe is billed);
     *  foregrounded it is 38 s of a lying header. The profile can be swapped
     *  without restarting the watchdog. */
    it('applies a new idle interval from the next arm without losing the identity', async () => {
      const { identity, sendProbe, watchdog } = fixture()
      watchdog.setProfile({ idleProbeMs: 10_000, probeTimeoutMs: 2_000 })
      watchdog.noteAuthenticatedInbound(identity)
      await vi.advanceTimersByTimeAsync(10_000 - 1)
      expect(sendProbe).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(sendProbe).toHaveBeenCalledOnce()
    })
  })
})
