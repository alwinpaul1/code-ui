import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
import { RelayOuterError } from './mobile-relay-e2ee-link'
import {
  bundle,
  dependencies,
  FakeLogicalClient,
  FakeRelaySession,
  FakeSession,
  host,
  mockCredentialRotation,
  relay
} from './mobile-endpoint-supervisor-test-fakes'
import { MobileEndpointSupervisor } from './mobile-endpoint-supervisor'
import type { ConnectionLogEntry } from './types'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))

// The relay credential gate, the log lines it leaves, and credential rotation
// across the clients one desktop can have. Evidence: a Pixel's diagnostics
// (Orca Mobile 0.9.54, 2026-09-27) logged "relay credential expired or
// rejected; slow reprobe armed", then "adopted fresher durable credential
// bundle" 170 ms later, with "recovery deferred by cooldown or gate" after
// every other line.

const fresh: MobileRelayCredentialBundle = {
  ...bundle,
  current: { ...bundle.current, token: 'C'.repeat(43), hash: 'D'.repeat(43), version: 3 }
}

function recordLog(): { entries: ConnectionLogEntry[]; onLog: (entry: ConnectionLogEntry) => void } {
  const entries: ConnectionLogEntry[] = []
  return { entries, onLog: (entry) => entries.push(entry) }
}

function messages(entries: readonly ConnectionLogEntry[], prefix: string): ConnectionLogEntry[] {
  return entries.filter((entry) => entry.message.startsWith(prefix))
}

/** v2 is refused with 4401 (BAD_OUTER_CREDENTIAL): the fresh-credential gate. */
function refusingV2() {
  return vi.fn(
    (_relay: unknown, credential: { version: number }) =>
      credential.version === bundle.current.version
        ? new FakeRelaySession('disconnected', new RelayOuterError(4401))
        : new FakeRelaySession('connected')
  )
}

describe('relay credential gate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['app-resume', 'user-send'] as const)(
    'dials at once on %s under a credential gate when the phone already holds a good credential',
    async (reason) => {
      const logical = new FakeLogicalClient('disconnected', 'relay')
      let disk: MobileRelayCredentialBundle = bundle
      const openRelay = refusingV2()
      const deps = dependencies({
        openRelay,
        readBundle: vi.fn(async () => disk),
        openDirect: vi.fn(() => new FakeSession('disconnected'))
      })
      const supervisor = new MobileEndpointSupervisor(logical, host, deps)
      await supervisor.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(openRelay).toHaveBeenCalledOnce()

      // Another client for this desktop, or a re-pair, has since written a good
      // credential. Resuming must not wait out a 1–15 min reprobe to find it.
      disk = fresh
      supervisor.nudge(reason)
      await vi.advanceTimersByTimeAsync(0)

      expect(openRelay).toHaveBeenCalledTimes(2)
      expect(openRelay).toHaveBeenLastCalledWith(
        relay,
        expect.objectContaining({ version: 3 }),
        expect.any(String),
        expect.any(Function)
      )
      expect(logical.getState()).toBe('connected')
      supervisor.stop()
    }
  )

  it('still waits out the gate on a focus nudge, which is not a manual retry', async () => {
    const logical = new FakeLogicalClient('disconnected', 'relay')
    let disk: MobileRelayCredentialBundle = bundle
    const openRelay = refusingV2()
    const deps = dependencies({
      openRelay,
      readBundle: vi.fn(async () => disk),
      openDirect: vi.fn(() => new FakeSession('disconnected'))
    })
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(0)

    disk = fresh
    supervisor.nudge('focus')
    await vi.advanceTimersByTimeAsync(0)

    expect(openRelay).toHaveBeenCalledOnce()
    supervisor.stop()
  })

  it('stays gated on an app resume when the durable credential is the one the relay refused', async () => {
    const logical = new FakeLogicalClient('disconnected', 'relay')
    const openRelay = refusingV2()
    const deps = dependencies({
      openRelay,
      readBundle: vi.fn(async () => bundle),
      openDirect: vi.fn(() => new FakeSession('disconnected'))
    })
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(openRelay).toHaveBeenCalledOnce()

    supervisor.nudge('app-resume')
    await vi.advanceTimersByTimeAsync(0)

    expect(openRelay).toHaveBeenCalledOnce()
    supervisor.stop()
  })

  // Review of this fix, 2026-09-27: a gate entered when the relay closes a LIVE
  // session with 4401 records no rejected version, so the same credential read
  // back from disk looked "not rejected", lifted the gate and was redialled at
  // once, under a line claiming a fresher bundle was adopted.
  it.each(['app-resume', 'user-send'] as const)(
    'does not redial on %s the credential the relay just closed a live session over',
    async (reason) => {
      const logical = new FakeLogicalClient('disconnected', 'relay')
      const { entries, onLog } = recordLog()
      const openRelay = vi.fn(() => new FakeRelaySession('connected', new RelayOuterError(4401)))
      const deps = dependencies({
        openRelay,
        readBundle: vi.fn(async () => bundle),
        openDirect: vi.fn(() => new FakeSession('disconnected')),
        onLog
      })
      const supervisor = new MobileEndpointSupervisor(logical, host, deps)
      await supervisor.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(logical.getState()).toBe('connected')
      logical.publishState('disconnected')
      await vi.advanceTimersByTimeAsync(0)
      expect(openRelay).toHaveBeenCalledOnce()

      supervisor.nudge(reason)
      await vi.advanceTimersByTimeAsync(0)

      expect(openRelay).toHaveBeenCalledOnce()
      expect(messages(entries, 'Relay: adopted fresher')).toEqual([])
      supervisor.stop()
    }
  )

  // Review of this fix, 2026-09-27: waiting on the Keystore before routing the
  // nudge meant a read that never returned swallowed the resume outright.
  it('still routes the resume when the credential read never returns', async () => {
    const logical = new FakeLogicalClient('disconnected', 'relay')
    const { entries, onLog } = recordLog()
    let reads = 0
    const deps = dependencies({
      openRelay: refusingV2(),
      readBundle: vi.fn(() => {
        reads += 1
        return reads === 1 ? Promise.resolve(bundle) : new Promise<never>(() => {})
      }),
      openDirect: vi.fn(() => new FakeSession('disconnected')),
      onLog
    })
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(messages(entries, 'Relay: recovery deferred')).toEqual([])

    supervisor.nudge('app-resume')
    await vi.advanceTimersByTimeAsync(0)

    expect(messages(entries, 'Relay: recovery deferred')).toHaveLength(1)
    supervisor.stop()
  })

  it('stays gated on an app resume when the credential store cannot be read', async () => {
    const logical = new FakeLogicalClient('disconnected', 'relay')
    const openRelay = refusingV2()
    let reads = 0
    const deps = dependencies({
      openRelay,
      readBundle: vi.fn(async () => {
        reads += 1
        if (reads > 1) {
          throw new Error('Keystore operation failed')
        }
        return bundle
      }),
      openDirect: vi.fn(() => new FakeSession('disconnected'))
    })
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(0)

    supervisor.nudge('app-resume')
    await vi.advanceTimersByTimeAsync(0)

    expect(openRelay).toHaveBeenCalledOnce()
    expect(logical.getState()).toBe('disconnected')
    supervisor.stop()
  })

  it('logs one deferred recovery per gate, naming the gate and when it tries next', async () => {
    const logical = new FakeLogicalClient('disconnected', 'relay')
    const { entries, onLog } = recordLog()
    const deps = dependencies({
      openRelay: refusingV2(),
      openDirect: vi.fn(() => new FakeSession('disconnected')),
      onLog
    })
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(0)

    for (let nudge = 0; nudge < 5; nudge++) {
      supervisor.nudge('focus')
      await vi.advanceTimersByTimeAsync(1_000)
    }

    const deferred = messages(entries, 'Relay: recovery deferred')
    expect(deferred).toHaveLength(1)
    expect(deferred[0]!.message).toBe('Relay: recovery deferred by fresh-credential gate')
    expect(deferred[0]!.detail).toMatch(/^next attempt at 2026-07-13T12:\d\d:\d\d\.\d{3}Z \(in \d+s\)$/)
    supervisor.stop()
  })

  it('logs a deferred recovery again once the next cooldown begins', async () => {
    const logical = new FakeLogicalClient('disconnected', 'relay')
    const { entries, onLog } = recordLog()
    const deps = dependencies({
      openRelay: vi.fn(() => new FakeRelaySession('disconnected', new RelayOuterError(4408))),
      openDirect: vi.fn(() => new FakeSession('disconnected')),
      randomBytes: () => new Uint8Array([255, 255]),
      onLog
    })
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    supervisor.nudge('focus')
    supervisor.nudge('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(messages(entries, 'Relay: recovery deferred by cooldown')).toHaveLength(1)

    // The cooldown lapses, the retry fails again, and a new cooldown begins.
    await vi.advanceTimersByTimeAsync(30_000)
    supervisor.nudge('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(messages(entries, 'Relay: recovery deferred by cooldown')).toHaveLength(2)
    supervisor.stop()
  })
})

describe('why no relay credential could be dialled', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function unavailableLine(
    overrides: Parameters<typeof dependencies>[0]
  ): Promise<ConnectionLogEntry[]> {
    const logical = new FakeLogicalClient('disconnected', 'relay')
    const { entries, onLog } = recordLog()
    const supervisor = new MobileEndpointSupervisor(
      logical,
      host,
      dependencies({ openDirect: vi.fn(() => new FakeSession('disconnected')), onLog, ...overrides })
    )
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    supervisor.stop()
    return entries.filter((entry) => entry.code === 'relay-credential-unavailable')
  }

  it('says the credential expired, and when', async () => {
    const expiresAt = Date.parse('2026-07-12T08:30:00Z')
    const lines = await unavailableLine({
      readBundle: vi.fn(async () => ({ ...bundle, current: { ...bundle.current, expiresAt } }))
    })
    expect(lines.map((line) => [line.message, line.detail])).toEqual([
      [
        'Relay: relay credential expired; slow reprobe armed',
        'version 2 expired at 2026-07-12T08:30:00.000Z'
      ]
    ])
  })

  it('says the credential was refused, and which version', async () => {
    const logical = new FakeLogicalClient('disconnected', 'relay')
    const { entries, onLog } = recordLog()
    const supervisor = new MobileEndpointSupervisor(
      logical,
      host,
      dependencies({
        openRelay: refusingV2(),
        openDirect: vi.fn(() => new FakeSession('disconnected')),
        onLog
      })
    )
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    // The slow reprobe finds the same refused credential in memory and on disk.
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    supervisor.stop()

    const lines = entries.filter((entry) => entry.code === 'relay-credential-unavailable')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.map((line) => [line.message, line.detail])).toContainEqual([
      'Relay: relay credential rejected; slow reprobe armed',
      'version 2 refused by the relay'
    ])
  })

  it('says the credential store could not be read, with the error, instead of blaming the credential', async () => {
    const lines = await unavailableLine({
      readBundle: vi.fn(async () => {
        throw new Error('Keystore operation failed')
      })
    })
    expect(lines.map((line) => [line.message, line.detail])).toEqual([
      [
        'Relay: relay credential store unreadable; slow reprobe armed',
        'Error: Keystore operation failed; no credential held in memory'
      ]
    ])
  })

  // The Pixel's shape: the credential in memory was refused, and the read that
  // could have found a better one failed. Both belong on the one line.
  it('names the refused credential it still holds when the store cannot be read', async () => {
    const logical = new FakeLogicalClient('disconnected', 'relay')
    const { entries, onLog } = recordLog()
    let reads = 0
    const supervisor = new MobileEndpointSupervisor(
      logical,
      host,
      dependencies({
        openRelay: refusingV2(),
        readBundle: vi.fn(async () => {
          reads += 1
          if (reads > 1) {
            throw new Error('Keystore operation failed')
          }
          return bundle
        }),
        openDirect: vi.fn(() => new FakeSession('disconnected')),
        onLog
      })
    )
    await supervisor.start()
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    supervisor.stop()

    const lines = entries.filter((entry) => entry.code === 'relay-credential-unavailable')
    expect(lines.map((line) => [line.message, line.detail])).toContainEqual([
      'Relay: relay credential store unreadable; slow reprobe armed',
      'Error: Keystore operation failed; held version 2 refused by the relay'
    ])
  })

  it('says there is no credential at all when the store is readable and empty', async () => {
    const lines = await unavailableLine({ readBundle: vi.fn(async () => null) })
    expect(lines.map((line) => line.message)).toEqual([
      'Relay: no relay credential bundle; slow reprobe armed'
    ])
  })
})

describe('credential rotation across the clients of one desktop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Each rotation installs a new credential and demotes the previous one to a
  // short grace. Two clients rotating at once each wrote their own pending
  // material and provisioned twice, so one of them was left holding a copy the
  // relay would refuse.
  it('provisions once when two clients for the desktop rotate the credential at once', async () => {
    const expiring = { ...bundle, current: { ...bundle.current, expiresAt: Date.now() + 86_400_000 } }
    const clients = [new FakeLogicalClient('connecting', 'lan'), new FakeLogicalClient('connecting', 'lan')]
    const writeBundle = vi.fn(async () => {})
    const supervisors = clients.map((logical) => {
      mockCredentialRotation(logical)
      return new MobileEndpointSupervisor(
        logical,
        host,
        dependencies({ readBundle: vi.fn(async () => expiring), writeBundle })
      )
    })
    for (const supervisor of supervisors) {
      await supervisor.start()
    }

    for (const logical of clients) {
      logical.publishState('connected')
    }
    await vi.advanceTimersByTimeAsync(0)

    const provisions = clients.flatMap((logical) =>
      logical.sendRequest.mock.calls.filter(([method]) => method === 'pairing.provisionRelay')
    )
    expect(provisions).toHaveLength(1)
    for (const supervisor of supervisors) {
      supervisor.stop()
    }
  })
})

describe('a closed client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('arms no reprobe when it is closed while its credential read is still in flight', async () => {
    const logical = new FakeLogicalClient('disconnected', 'relay')
    let finishRead: (value: MobileRelayCredentialBundle | null) => void = () => {}
    let reads = 0
    const setTimer = vi.fn(setTimeout) as unknown as typeof setTimeout
    const deps = dependencies({
      readBundle: vi.fn(() => {
        reads += 1
        if (reads === 1) {
          return Promise.resolve(null)
        }
        return new Promise<MobileRelayCredentialBundle | null>((resolve) => {
          finishRead = resolve
        })
      }),
      openDirect: vi.fn(() => new FakeSession('disconnected')),
      setTimer
    })
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)
    const started = supervisor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toBe(2)

    supervisor.stop()
    const timersBefore = vi.mocked(setTimer).mock.calls.length
    finishRead(null)
    await started
    await vi.advanceTimersByTimeAsync(0)

    expect(vi.mocked(setTimer).mock.calls.length).toBe(timersBefore)
    expect(vi.getTimerCount()).toBe(0)
  })
})
