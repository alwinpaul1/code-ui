import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionLogEntry } from '../transport/types'

/**
 * The pause handler is unit-tested on its own (app-pause-handler.test.ts).
 * This drives the app's REAL pause callback in background-link.ts, with only
 * the native module and storage faked, so a handler that is correct but
 * wired to the wrong start, or to no start, fails here.
 */

let onPause: ((pause: { from: number; to: number }) => void) | null = null
vi.mock('./app-pause-detector', async (importActual) => ({
  ...(await importActual<typeof import('./app-pause-detector')>()),
  AppPauseDetector: class {
    constructor(dependencies: { onPause: (pause: { from: number; to: number }) => void }) {
      onPause = dependencies.onPause
    }
    start(): void {}
  }
}))

const appState = { currentState: 'background' }
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return appState.currentState
    },
    addEventListener: () => ({ remove: () => undefined })
  },
  Platform: { OS: 'android' }
}))

const native = {
  running: false,
  unrestricted: true,
  start: vi.fn<(title: string, text: string) => void>()
}
vi.mock('@codeui/expo-background-link', () => ({
  isBackgroundLinkSupported: true,
  isBackgroundLinkRunning: () => native.running,
  isBackgroundLinkUnrestricted: () => native.unrestricted,
  requestBackgroundLinkUnrestricted: () => false,
  startBackgroundLink: (title: string, text: string) => native.start(title, text),
  stopBackgroundLink: () => undefined
}))
vi.mock('expo', () => ({
  requireOptionalNativeModule: () => ({
    lastStop: () => ({ startedAt: 1_000, stoppedAt: 2_000, cause: 'task-ended' })
  })
}))

const preferences = { delivery: true, push: true }
vi.mock('./background-link-preference', () => ({
  loadBackgroundDeliveryEnabled: async () => preferences.delivery
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: async () => preferences.push,
  clearBackgroundPowerRequested: async () => undefined,
  loadBackgroundPowerRequestedAgo: async () => null,
  loadBackgroundPowerAskedAgo: async () => null,
  loadBackgroundPowerLastSeen: async () => null,
  saveBackgroundPowerAskedNow: async () => undefined,
  saveBackgroundPowerLastSeen: async () => undefined
}))

const appended: ConnectionLogEntry[] = []
vi.mock('../transport/host-store', () => ({ loadHosts: async () => [{ id: 'host-1' }] }))
vi.mock('../transport/persisted-connection-log-store', () => ({
  connectionLogStore: { append: (_hostId: string, entry: ConnectionLogEntry) => appended.push(entry) }
}))
vi.mock('../transport/live-host-clients', () => ({ peekLiveHostClient: () => null }))
vi.mock('../transport/host-logical-client', () => ({ openHostLogicalClient: () => null }))
vi.mock('../transport/connection-revival-triggers', () => ({
  subscribeConnectionRevivalTriggers: () => () => undefined
}))
vi.mock('../transport/timer-scheduler', () => ({
  defaultScheduleTimer: () => null,
  defaultCancelTimer: () => undefined
}))
vi.mock('../notifications/mobile-notifications', () => ({ subscribeToDesktopNotifications: () => () => undefined }))
vi.mock('./background-notification-watcher', () => ({
  createBackgroundNotificationWatcher: () => ({ setEnabled: () => undefined, setUiVisible: () => undefined })
}))
vi.mock('./background-power-prompt-store', () => ({ openBackgroundPowerPrompt: () => undefined }))

const { getBackgroundLinkWatcher } = await import('./background-link')
getBackgroundLinkWatcher()

async function wakeFromPause(): Promise<void> {
  if (!onPause) {
    throw new Error('background-link.ts never built its pause detector')
  }
  onPause({ from: Date.parse('2026-09-27T11:52:17Z'), to: Date.parse('2026-09-27T12:52:17Z') })
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve()
  }
}

describe('the app waking from a pause with its background service dead', () => {
  beforeEach(() => {
    appState.currentState = 'background'
    native.running = false
    native.unrestricted = true
    native.start.mockReset()
    preferences.delivery = true
    preferences.push = true
    appended.length = 0
  })

  it('starts the service again when delivery is on', async () => {
    await wakeFromPause()

    expect(native.start).toHaveBeenCalledOnce()
    expect(appended.map((entry) => entry.message)).toEqual([
      'Android paused the app',
      'Restarted the background service'
    ])
  })

  it('logs the refusal instead of throwing out of the pause callback', async () => {
    native.unrestricted = false
    native.start.mockImplementation(() => {
      throw new Error('startForegroundService() not allowed due to mAllowStartForeground false')
    })
    await wakeFromPause()

    expect(appended.map((entry) => entry.message)).toEqual([
      'Android paused the app',
      'Could not restart the background service'
    ])
  })

  it('leaves the start to the foreground heal when the pause is noticed on an open', async () => {
    appState.currentState = 'active'
    await wakeFromPause()

    expect(native.start).not.toHaveBeenCalled()
    expect(appended.map((entry) => entry.message)).toEqual(['Android paused the app'])
  })

  it('leaves it stopped when notifications are off', async () => {
    preferences.push = false
    await wakeFromPause()

    expect(native.start).not.toHaveBeenCalled()
    expect(appended.map((entry) => entry.message)).toEqual(['Android paused the app'])
  })
})
