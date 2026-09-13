import { Platform } from 'react-native'
import * as BackgroundTask from 'expo-background-task'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { loadBackgroundUpdateCheckEnabled } from './auto-update-preference'
import { performUpdateCheck } from './check-update'
import { LAST_AVAILABLE_KEY } from './app-update-store'
import { getInstalledBuildNumber, getInstalledVersion } from './installed-version'
import {
  appUpdateNotificationContent,
  buildAppUpdateNotificationData,
  planBackgroundUpdateCheck
} from './update-notification'
import { ensureNotificationChannel } from '../notifications/local-notification-scheduling'

// A periodic check that runs with the app closed, on WorkManager (Android's
// scheduler for deferrable background work), so a release reaches the phone
// the way a system update does: a notification, then one tap. The download
// and install that follow are DownloadManager's and PackageInstaller's and
// survive the app being closed too (apk-install-store.ts).
//
// Why not download from here as well: the APK is ~170 MB and WorkManager's
// window is short and its network unconstrained; a person should choose when
// that much data moves. The notification is the choice.

export const BACKGROUND_UPDATE_CHECK_TASK = 'codeui-app-update-check'
const LAST_NOTIFIED_KEY = 'codeui:update-notified-version'
// Why 60 min: WorkManager treats this as a floor and batches; an hourly floor
// lands a release within a few hours of tagging without polling GitHub all day.
const MINIMUM_INTERVAL_MINUTES = 60
const CHECK_TIMEOUT_MS = 15_000

export async function runBackgroundUpdateCheck(): Promise<void> {
  const enabled = await loadBackgroundUpdateCheckEnabled()
  if (!enabled) {
    return
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  let result
  try {
    result = await performUpdateCheck({
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      installedVersion: getInstalledVersion(),
      installedBuildNumber: getInstalledBuildNumber(),
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
  // Why persist here too: the app's own check is throttled to 30 minutes, so
  // a tap on this notification could open a Home whose last foreground answer
  // was "up to date" and show no banner until the user asked again by hand
  // (2026-09-13). The store hydrates from this key on every open.
  if (result.status === 'available') {
    await AsyncStorage.setItem(LAST_AVAILABLE_KEY, JSON.stringify(result)).catch(() => {})
  }
  const lastNotifiedVersion = await AsyncStorage.getItem(LAST_NOTIFIED_KEY).catch(() => null)
  const plan = planBackgroundUpdateCheck({ enabled, result, lastNotifiedVersion })
  console.log('[app-update] background check', { result, plan })
  if (plan.action !== 'notify') {
    return
  }
  // Why no permission prompt here: there is no screen to prompt on. A phone
  // that never granted notifications simply sees the dialog on next open.
  const permission = await Notifications.getPermissionsAsync().catch(() => null)
  if (!permission?.granted) {
    return
  }
  await ensureNotificationChannel()
  await Notifications.scheduleNotificationAsync({
    content: {
      ...appUpdateNotificationContent(plan.version),
      data: buildAppUpdateNotificationData(plan.version)
    },
    trigger: Platform.OS === 'android' ? { channelId: 'orca-desktop' } : null
  })
  await AsyncStorage.setItem(LAST_NOTIFIED_KEY, plan.version).catch(() => {})
}

// Defined at module scope: WorkManager starts the JS runtime headless and
// looks the task up by name before any screen renders. index.ts imports this
// file for that reason.
TaskManager.defineTask(BACKGROUND_UPDATE_CHECK_TASK, async () => {
  try {
    await runBackgroundUpdateCheck()
  } catch (error) {
    console.log('[app-update] background check failed', String(error))
  }
  return BackgroundTask.BackgroundTaskResult.Success
})

/** Register or unregister the periodic check to match the preference. Safe
 *  to call on every launch; registration is idempotent. */
export async function syncBackgroundUpdateCheck(): Promise<void> {
  if (Platform.OS !== 'android') {
    return
  }
  try {
    const enabled = await loadBackgroundUpdateCheckEnabled()
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_UPDATE_CHECK_TASK)
    if (enabled && !registered) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_UPDATE_CHECK_TASK, {
        minimumInterval: MINIMUM_INTERVAL_MINUTES
      })
    } else if (!enabled && registered) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_UPDATE_CHECK_TASK)
    }
  } catch (error) {
    console.log('[app-update] background check registration failed', String(error))
  }
}
