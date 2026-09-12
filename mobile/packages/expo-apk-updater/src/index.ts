import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

/** What a native event listener returns; mirrors expo-modules-core's shape
 *  without importing the package, which pnpm keeps out of this workspace. */
export type ApkUpdateSubscription = { remove(): void }

export type ApkUpdatePhase =
  | 'idle'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'pending-user-action'
  | 'failed'

export type ApkUpdateState = {
  phase: ApkUpdatePhase
  version: string | null
  message: string | null
  pendingUserAction: boolean
}

type NativeApkUpdater = {
  isSilentUpdateSupported(): boolean
  getState(): ApkUpdateState
  startUpdate(url: string, version: string): Promise<ApkUpdateState>
  install(): boolean
  hasPendingUserAction(): boolean
  launchPendingUserAction(): boolean
  clear(): void
  addListener(eventName: 'onProgress', listener: (event: { progress: number }) => void): ApkUpdateSubscription
  addListener(eventName: 'onStatus', listener: (event: ApkUpdateState) => void): ApkUpdateSubscription
}

// Why optional: Android only, and absent from the vitest runtime. Every entry
// point degrades to "unavailable" there, which sends the install store down
// the in-process download + ACTION_VIEW path it used before this module.
const native: NativeApkUpdater | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeApkUpdater>('ApkUpdater') : null

export const isApkUpdaterAvailable = native !== null

/** True when the OS can update this app without a confirmation tap (Android 12+). */
export function isSilentUpdateSupported(): boolean {
  return native?.isSilentUpdateSupported() ?? false
}

export function getApkUpdateState(): ApkUpdateState | null {
  return native?.getState() ?? null
}

/** Hand the APK to DownloadManager. The system carries the download, shows
 *  its own notification, and installs on completion even if the app is
 *  closed. Resolves with the state right after enqueueing. */
export async function startApkUpdate(url: string, version: string): Promise<ApkUpdateState | null> {
  if (!native) {
    return null
  }
  return native.startUpdate(url, version)
}

/** Commit the install for an already-downloaded APK (retry, or after the
 *  system asked for a tap while the app was closed). */
export function installDownloadedApk(): boolean {
  return native?.install() ?? false
}

export function hasPendingInstallUserAction(): boolean {
  return native?.hasPendingUserAction() ?? false
}

/** Show the confirmation the system asked for. Call from the foreground. */
export function launchPendingInstallUserAction(): boolean {
  return native?.launchPendingUserAction() ?? false
}

export function clearApkUpdateState(): void {
  native?.clear()
}

export function addApkUpdateProgressListener(
  listener: (progress: number) => void
): ApkUpdateSubscription | null {
  return native?.addListener('onProgress', (event) => listener(event.progress)) ?? null
}

export function addApkUpdateStatusListener(
  listener: (state: ApkUpdateState) => void
): ApkUpdateSubscription | null {
  return native?.addListener('onStatus', listener) ?? null
}
