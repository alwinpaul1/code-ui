import { expect, it, vi } from 'vitest'
import {
  dependencies,
  FakeSession,
  host
} from './mobile-endpoint-supervisor-test-fakes'
// Only the migration-fencing cases from upstream #18940 are kept here. The four
// removed ones assert upstream's dial architecture; Code UI replaced it with a
// launch race and a network-type gate, so the same property is pinned against
// Code UI's own shape in mobile-direct-return-probe-stop.test.ts.
import { MobileEndpointHysteresis } from './mobile-endpoint-hysteresis'
import { createStableLogicalRpcClient } from './stable-logical-rpc-client'
import { MobileEndpointSupervisor } from './mobile-endpoint-supervisor'
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))




it.each([false, true])(
  'fences migration finishing after stop (already swapped: %s)',
  async (alreadySwapped) => {
    vi.useFakeTimers()
    try {
      const recordedMigration = vi.spyOn(MobileEndpointHysteresis.prototype, 'recordMigration')
      const relay = new FakeSession('connected')
      const logical = createStableLogicalRpcClient(relay, 'relay')
      const candidates: FakeSession[] = []
      const deps = dependencies({
        openDirect: vi.fn(() => {
          const candidate = new FakeSession('connected')
          candidates.push(candidate)
          return candidate
        })
      })
      const supervisor = new MobileEndpointSupervisor(logical, host, deps)
      const migrate = logical.migrateTo.bind(logical)
      let release!: () => void
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      const migration = vi.spyOn(logical, 'migrateTo').mockImplementation(async (...args) => {
        if (alreadySwapped) {
          await migrate(...args)
        }
        await pending
        if (!alreadySwapped) {
          await migrate(...args)
        }
      })
      await supervisor.start()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(migration).toHaveBeenCalledOnce()
      const requestsBeforeStop = relay.sendRequest.mock.calls.length
      const candidateRequestsBeforeStop = candidates[3].sendRequest.mock.calls.length
      const migrationsBeforeStop = recordedMigration.mock.calls.length
      supervisor.stop()
      release()
      await vi.advanceTimersByTimeAsync(0)
      expect(logical.getActivePath()).toBe(alreadySwapped ? 'lan' : 'relay')
      expect(logical.getGeneration()).toBe(alreadySwapped ? 2 : 1)
      expect(relay.sendRequest).toHaveBeenCalledTimes(requestsBeforeStop)
      expect(candidates[3].sendRequest).toHaveBeenCalledTimes(candidateRequestsBeforeStop)
      expect(recordedMigration).toHaveBeenCalledTimes(migrationsBeforeStop)
      expect(candidates[3].close).toHaveBeenCalledTimes(alreadySwapped ? 0 : 1)
      expect(vi.getTimerCount()).toBe(0)
      logical.close()
    } finally {
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  }
)
