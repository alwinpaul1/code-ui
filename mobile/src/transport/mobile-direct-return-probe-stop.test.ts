import { describe, expect, it, vi } from 'vitest'
import { DirectReturnProbe } from './mobile-direct-return-probe'
import type { RpcClient } from './rpc-client'

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))

function neverAuthenticatingClient() {
  return {
    getState: () => 'connecting',
    onStateChange: () => () => undefined,
    close: vi.fn()
  } as unknown as RpcClient & { close: ReturnType<typeof vi.fn> }
}

function probeWith(openDirect: () => RpcClient) {
  const hysteresis = {
    canProbe: () => true,
    recordDirectFailure: vi.fn(),
    recordDirectSuccess: () => true,
    recordMigration: vi.fn()
  }
  const migrate = vi.fn(async () => undefined)
  const probe = new DirectReturnProbe(
    {
      now: () => Date.now(),
      setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimer: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
      openDirect
    } as never,
    {
      host: () => ({ endpoint: 'http://10.0.0.2:6768', endpoints: [] }),
      hysteresis,
      canSchedule: () => true,
      canAttempt: () => true,
      beginOperation: vi.fn(),
      migrate,
      onDirectMigrated: async () => undefined,
      afterProbe: vi.fn()
    } as never
  )
  return { probe, migrate }
}

describe('a direct probe whose owner has stopped', () => {
  it('closes the socket it was dialling instead of leaving it open', async () => {
    vi.useFakeTimers()
    try {
      const candidate = neverAuthenticatingClient()
      const { probe } = probeWith(() => candidate)
      probe.schedule(0)
      await vi.advanceTimersByTimeAsync(0)

      probe.stop()
      await vi.advanceTimersByTimeAsync(0)

      expect(candidate.close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves no timer behind, so nothing dials again after the owner is gone', async () => {
    vi.useFakeTimers()
    try {
      const candidate = neverAuthenticatingClient()
      const openDirect = vi.fn(() => candidate)
      const { probe } = probeWith(openDirect)
      probe.schedule(0)
      await vi.advanceTimersByTimeAsync(0)

      probe.stop()
      await vi.advanceTimersByTimeAsync(60_000)

      expect(openDirect).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never schedules another probe once stopped', () => {
    vi.useFakeTimers()
    try {
      const { probe } = probeWith(() => neverAuthenticatingClient())
      probe.stop()
      probe.schedule(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
