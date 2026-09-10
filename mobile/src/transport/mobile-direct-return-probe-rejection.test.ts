import { describe, expect, it, vi } from 'vitest'
import { DirectReturnProbe } from './mobile-direct-return-probe'
import type { RpcClient } from './rpc-client'

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))

describe('a direct probe whose migration is fenced off', () => {
  it('settles quietly instead of leaving an unhandled rejection', async () => {
    // The stop fence makes migrateTo throw "migration superseded". The probe
    // is started with `void this.probe()`, so a throw that escapes it becomes
    // an unhandled rejection and, on a strict runtime, a crash.
    const client = {
      getState: () => 'connected',
      onStateChange: () => () => undefined,
      close: vi.fn()
    } as unknown as RpcClient
    const probe = new DirectReturnProbe(
      {
        now: () => Date.now(),
        setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearTimer: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
        openDirect: () => client
      } as never,
      {
        host: () => ({ endpoint: 'http://10.0.0.2:6768', endpoints: [] }),
        hysteresis: {
          canProbe: () => true,
          recordDirectFailure: vi.fn(),
          recordDirectSuccess: () => true,
          recordMigration: vi.fn()
        },
        canSchedule: () => true,
        canAttempt: () => true,
        beginOperation: vi.fn(),
        migrate: async () => {
          throw new Error('migration superseded')
        },
        onDirectMigrated: async () => undefined,
        afterProbe: vi.fn()
      } as never
    )

    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)
    try {
      probe.schedule(0)
      await new Promise((resolve) => setTimeout(resolve, 20))
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      process.off('unhandledRejection', onRejection)
    }

    expect(rejections).toEqual([])
  })
})
