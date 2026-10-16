import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 2026-10-16, asked by the user: "Set Settings → Apps → Code UI → Battery → Unrestricted. Make this
 * work automatically by default." Android lets no app grant itself the exemption, so the nearest
 * thing is its own one-tap dialog, opened by the app at launch. This drives the app's real launch
 * call (askBackgroundDeliveryPowerOnOpen, from app/_layout.tsx) with only the native module and
 * storage faked: every launch without the exemption opens Android's dialog itself, with no sheet of
 * the app's own in front of it and no cooldown after a decline.
 */

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: 'android' }
}))

const native = {
  unrestricted: false,
  request: vi.fn(() => true),
  start: vi.fn()
}
vi.mock('@codeui/expo-background-link', () => ({
  isBackgroundLinkSupported: true,
  isBackgroundLinkRunning: () => true,
  isBackgroundLinkUnrestricted: () => native.unrestricted,
  requestBackgroundLinkUnrestricted: () => native.request(),
  startBackgroundLink: () => native.start(),
  stopBackgroundLink: () => undefined
}))
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }))

const preferences = { delivery: true, push: true, requested: 0 }
vi.mock('./background-link-preference', () => ({
  loadBackgroundDeliveryEnabled: async () => preferences.delivery
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: async () => preferences.push,
  clearBackgroundPowerRequested: async () => undefined,
  loadBackgroundPowerRequestedAgo: async () => null,
  saveBackgroundPowerRequestedNow: async () => {
    preferences.requested += 1
  }
}))
vi.mock('../transport/host-store', () => ({ loadHosts: async () => [] }))
vi.mock('../transport/persisted-connection-log-store', () => ({ connectionLogStore: { append: () => undefined } }))
vi.mock('../transport/live-host-clients', () => ({ peekLiveHostClient: () => null }))
vi.mock('../transport/host-logical-client', () => ({ openHostLogicalClient: () => null }))
vi.mock('../transport/connection-revival-triggers', () => ({ subscribeConnectionRevivalTriggers: () => () => undefined }))
vi.mock('../transport/timer-scheduler', () => ({ defaultScheduleTimer: () => null, defaultCancelTimer: () => undefined }))
vi.mock('../notifications/mobile-notifications', () => ({ subscribeToDesktopNotifications: () => () => undefined }))
vi.mock('./background-notification-watcher', () => ({
  createBackgroundNotificationWatcher: () => ({ setEnabled: () => undefined, setUiVisible: () => undefined })
}))
const sheet = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('./background-power-prompt-store', () => ({ openBackgroundPowerPrompt: sheet.open }))

const { askBackgroundDeliveryPowerOnOpen } = await import('./background-link')

describe('a launch while Android still optimises the app', () => {
  beforeEach(() => {
    native.unrestricted = false
    native.request.mockClear()
    sheet.open.mockClear()
    preferences.delivery = true
    preferences.push = true
    preferences.requested = 0
  })

  it("opens Android's own exemption dialog, with no sheet of the app's in front of it", async () => {
    await askBackgroundDeliveryPowerOnOpen()
    expect(native.request).toHaveBeenCalledTimes(1)
    expect(sheet.open).not.toHaveBeenCalled()
    // Marked, so the return from Android's screen can say whether it went through.
    expect(preferences.requested).toBe(1)
  })

  it('opens it again on the next launch, though it was declined a minute ago', async () => {
    await askBackgroundDeliveryPowerOnOpen()
    await askBackgroundDeliveryPowerOnOpen()
    expect(native.request).toHaveBeenCalledTimes(2)
  })

  it('does not open it once the exemption is granted', async () => {
    native.unrestricted = true
    await askBackgroundDeliveryPowerOnOpen()
    expect(native.request).not.toHaveBeenCalled()
  })

  it('does not open it while agent notifications are off', async () => {
    preferences.push = false
    await askBackgroundDeliveryPowerOnOpen()
    expect(native.request).not.toHaveBeenCalled()
  })
})
