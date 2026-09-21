import { beforeEach, describe, expect, it, vi } from 'vitest'

let platformOS = 'android'
let tokenImpl: () => Promise<{ type: string; data: string }> = async () => ({
  type: 'android',
  data: 'fcm-token-1'
})
let permissionGranted = true

vi.mock('react-native', () => ({
  AppState: { currentState: 'background' },
  get Platform() {
    return { OS: platformOS }
  }
}))
vi.mock('expo-notifications', () => ({
  getDevicePushTokenAsync: vi.fn(() => tokenImpl())
}))
vi.mock('./notification-permissions', () => ({
  ensureNotificationPermissions: vi.fn(async () => permissionGranted)
}))

const { acquirePushToken } = await import('./push-token')

/**
 * Getting a token is the first thing that runs on a device with no Firebase
 * config, and it throws there. A generic "unavailable" sends whoever reads the
 * log hunting through the notification stack; naming the missing file points at
 * the one thing that fixes it.
 */
describe('asking Android for a push token', () => {
  beforeEach(() => {
    platformOS = 'android'
    permissionGranted = true
    tokenImpl = async () => ({ type: 'android', data: 'fcm-token-1' })
  })

  it('returns the FCM token', async () => {
    expect(await acquirePushToken()).toEqual({
      ok: true,
      platform: 'android',
      token: 'fcm-token-1'
    })
  })

  it('names the missing google-services.json rather than saying "unavailable"', async () => {
    tokenImpl = async () => {
      throw new Error('Default FirebaseApp is not initialized in this process')
    }
    expect(await acquirePushToken()).toMatchObject({ ok: false, reason: 'no-firebase-config' })
  })

  it('names it when the error mentions the file directly', async () => {
    tokenImpl = async () => {
      throw new Error('google-services.json is missing')
    }
    expect(await acquirePushToken()).toMatchObject({ ok: false, reason: 'no-firebase-config' })
  })

  // Failure path: anything else must still be a result, not a throw, because the
  // caller runs during app start.
  it('reports an unexpected failure without throwing', async () => {
    tokenImpl = async () => {
      throw new Error('SERVICE_NOT_AVAILABLE')
    }
    const result = await acquirePushToken()
    expect(result).toMatchObject({ ok: false, reason: 'unavailable' })
    expect(result.ok === false && result.detail).toContain('SERVICE_NOT_AVAILABLE')
  })

  it('does not ask for a token without notification permission', async () => {
    permissionGranted = false
    expect(await acquirePushToken()).toMatchObject({ ok: false, reason: 'permission-denied' })
  })

  // This fork ships Android only; iOS would need an APNs environment the build
  // cannot determine, and a wrong one routes every push into a black hole.
  it('refuses on a platform this build has no push story for', async () => {
    platformOS = 'ios'
    expect(await acquirePushToken()).toMatchObject({ ok: false, reason: 'unsupported-platform' })
  })

  // Degenerate: a token call that "succeeds" with nothing in it is a failure.
  it('treats an empty token as no token', async () => {
    tokenImpl = async () => ({ type: 'android', data: '' })
    expect(await acquirePushToken()).toMatchObject({ ok: false, reason: 'unavailable' })
  })
})
