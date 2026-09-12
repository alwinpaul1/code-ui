import type { UpdateCheckResult } from './check-update'

/** The `data` a Code UI update notification carries; a tap opens Home, where
 *  the update dialog is already waiting. */
export type AppUpdateNotificationData = { source: 'app-update'; version: string }

export function buildAppUpdateNotificationData(version: string): AppUpdateNotificationData {
  return { source: 'app-update', version }
}

export function isAppUpdateNotification(data: unknown): data is AppUpdateNotificationData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Reflect.get(data, 'source') === 'app-update' &&
    typeof Reflect.get(data, 'version') === 'string'
  )
}

export function appUpdateNotificationContent(version: string): { title: string; body: string } {
  return {
    title: `Code UI ${version} is available`,
    body: 'Tap to see what is new and install it.'
  }
}

export type BackgroundUpdateCheckPlan =
  | { action: 'skip'; reason: 'disabled' | 'not-available' | 'already-notified' }
  | { action: 'notify'; version: string }

/**
 * Decide what a background check does with its result. Pure, so the timing
 * of WorkManager never enters a test. One notification per version: the
 * check runs every hour or so, and nobody wants the same release announced
 * every hour until they open the app.
 */
export function planBackgroundUpdateCheck(input: {
  enabled: boolean
  result: UpdateCheckResult
  lastNotifiedVersion: string | null
}): BackgroundUpdateCheckPlan {
  if (!input.enabled) {
    return { action: 'skip', reason: 'disabled' }
  }
  if (input.result.status !== 'available') {
    return { action: 'skip', reason: 'not-available' }
  }
  if (input.lastNotifiedVersion === input.result.latestVersion) {
    return { action: 'skip', reason: 'already-notified' }
  }
  return { action: 'notify', version: input.result.latestVersion }
}
