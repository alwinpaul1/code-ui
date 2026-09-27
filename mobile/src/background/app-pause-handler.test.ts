import { describe, expect, it, vi } from 'vitest'
import type { ConnectionLogEntry } from '../transport/types'
import { handleAppPause, type AppPauseHandlerDependencies } from './app-pause-handler'

const from = Date.parse('2026-09-27T11:52:17Z')
const pause = { from, to: from + 60 * 60_000 }

function makeDependencies(overrides: Partial<AppPauseHandlerDependencies> = {}) {
  const entries: ConnectionLogEntry[] = []
  const dependencies: AppPauseHandlerDependencies = {
    now: () => pause.to + 5,
    appInForeground: () => false,
    backgroundState: () => ({ serviceRunning: false, unrestricted: true }),
    lastServiceStop: () => ({ at: from - 60_000, cause: 'its task ended' }),
    loadDeliveryOn: async () => true,
    startService: vi.fn(),
    record: (entry) => entries.push(entry),
    ...overrides
  }
  return { dependencies, entries }
}

// Android 12+ refuses a foreground-service start from the background unless
// the app is exempt from battery optimisation. This is Android's message for
// it, which the JS error carries.
function refusedStart(): never {
  throw new Error(
    'startForegroundService() not allowed due to mAllowStartForeground false: service com.alwinpaul.codeui/expo.modules.backgroundlink.BackgroundLinkService'
  )
}

describe('what the app does when it wakes from a pause', () => {
  it('logs the pause first, with the stop the service recorded', async () => {
    const { dependencies, entries } = makeDependencies()
    await handleAppPause(pause, dependencies)

    expect(entries[0]).toMatchObject({ code: 'app-paused', message: 'Android paused the app' })
    expect(entries[0]?.detail).toContain('background service not running (stopped at ')
  })

  // The Pixel (2026-09-27, battery unrestricted) woke every hour for the
  // update check, found the service dead, logged it, and went back to sleep
  // with it still dead until someone opened the app. Unrestricted, Android
  // allows the start from the background, so the wake can bring it back.
  it('restarts the stopped service when delivery is on and the battery is unrestricted', async () => {
    const { dependencies, entries } = makeDependencies()
    await handleAppPause(pause, dependencies)

    expect(dependencies.startService).toHaveBeenCalledOnce()
    expect(entries[1]).toMatchObject({ level: 'info', message: 'Restarted the background service' })
    expect(entries[1]?.ts).toBe(pause.to + 5)
  })

  it('says so plainly when Android refuses the start while the battery is optimised', async () => {
    const { dependencies, entries } = makeDependencies({
      backgroundState: () => ({ serviceRunning: false, unrestricted: false }),
      startService: vi.fn(refusedStart)
    })
    await expect(handleAppPause(pause, dependencies)).resolves.toBeUndefined()

    expect(dependencies.startService).toHaveBeenCalledOnce()
    expect(entries[1]).toMatchObject({ level: 'warn', message: 'Could not restart the background service' })
    expect(entries[1]?.detail).toContain('mAllowStartForeground false')
    expect(entries[1]?.detail).toContain('battery use is optimised')
    expect(entries[1]?.detail).toContain('next time the app is opened')
  })

  it('names a refusal even when the battery is unrestricted, without blaming the battery', async () => {
    const { dependencies, entries } = makeDependencies({ startService: vi.fn(refusedStart) })
    await handleAppPause(pause, dependencies)

    expect(entries[1]).toMatchObject({ level: 'warn', message: 'Could not restart the background service' })
    expect(entries[1]?.detail).not.toContain('battery use is optimised')
  })

  it('leaves a running service alone', async () => {
    const { dependencies, entries } = makeDependencies({
      backgroundState: () => ({ serviceRunning: true, unrestricted: true })
    })
    await handleAppPause(pause, dependencies)

    expect(dependencies.startService).not.toHaveBeenCalled()
    expect(entries).toHaveLength(1)
  })

  // Noticed on an open: heal() (background-link-healing.ts) starts the service
  // on the same return to the foreground, so a "Restarted" line here would
  // claim a start this handler did not need to make.
  it('leaves the restart to the foreground heal when the pause is noticed on an open', async () => {
    const { dependencies, entries } = makeDependencies({ appInForeground: () => true })
    await handleAppPause(pause, dependencies)

    expect(dependencies.startService).not.toHaveBeenCalled()
    expect(entries.map((entry) => entry.message)).toEqual(['Android paused the app'])
  })

  it('does not start a service the user switched off', async () => {
    const { dependencies, entries } = makeDependencies({ loadDeliveryOn: async () => false })
    await handleAppPause(pause, dependencies)

    expect(dependencies.startService).not.toHaveBeenCalled()
    expect(entries).toHaveLength(1)
  })

  it('does not guess when the setting cannot be read, and says why it did nothing', async () => {
    const { dependencies, entries } = makeDependencies({
      loadDeliveryOn: async () => {
        throw new Error('AsyncStorage unavailable')
      }
    })
    await expect(handleAppPause(pause, dependencies)).resolves.toBeUndefined()

    expect(dependencies.startService).not.toHaveBeenCalled()
    expect(entries[1]).toMatchObject({ level: 'warn', message: 'Could not restart the background service' })
    expect(entries[1]?.detail).toContain('AsyncStorage unavailable')
  })
})
