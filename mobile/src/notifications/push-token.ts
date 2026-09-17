import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { ensureNotificationPermissions } from './notification-permissions'
import type { MobilePushPlatform } from '../../../src/shared/mobile-push-contract'

export type PushTokenResult =
  | { ok: true; platform: MobilePushPlatform; token: string }
  | {
      ok: false
      reason: 'unsupported-platform' | 'permission-denied' | 'no-firebase-config' | 'unavailable'
      detail?: string
    }

/**
 * Error text that means the app was built without Firebase credentials.
 *
 * Why match on strings at all: the failure is thrown from Android's Firebase SDK
 * through two bridges, and nothing structured survives the trip. Matching is
 * fragile, so it only ever CHANGES THE DIAGNOSTIC — an unmatched error still
 * reports a failure, just a less specific one.
 */
const MISSING_FIREBASE_CONFIG_PATTERNS = [
  'default firebaseapp is not initialized',
  'google-services',
  'firebaseapp.initializeapp',
  'no firebase app'
]

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return typeof error === 'string' ? error : 'unknown error'
}

/**
 * The device's FCM token, or a named reason there isn't one.
 *
 * Never throws. It runs on the app-start path, where a rejection is an unhandled
 * promise in release and a redbox in development, and no push is a far smaller
 * problem than no app.
 *
 * Android only: an iOS token is inseparable from its APNs environment, and a
 * token registered against the wrong one is accepted and then silently delivers
 * nothing, which is worse than refusing.
 */
export async function acquirePushToken(): Promise<PushTokenResult> {
  if (Platform.OS !== 'android') {
    return { ok: false, reason: 'unsupported-platform' }
  }
  // Why first: on Android 13+ a token without POST_NOTIFICATIONS is a route to a
  // banner the system will not draw, so registering it wastes a gateway slot.
  if (!(await ensureNotificationPermissions())) {
    return { ok: false, reason: 'permission-denied' }
  }
  try {
    const token = await Notifications.getDevicePushTokenAsync()
    const value = typeof token?.data === 'string' ? token.data : ''
    if (value === '') {
      // A call that resolves with nothing is a failure wearing a success's shape.
      return { ok: false, reason: 'unavailable', detail: 'empty token' }
    }
    return { ok: true, platform: 'android', token: value }
  } catch (error) {
    const detail = describe(error)
    const lowered = detail.toLowerCase()
    if (MISSING_FIREBASE_CONFIG_PATTERNS.some((pattern) => lowered.includes(pattern))) {
      return {
        ok: false,
        reason: 'no-firebase-config',
        detail: `${detail} (add mobile/google-services.json and rebuild)`
      }
    }
    return { ok: false, reason: 'unavailable', detail }
  }
}
