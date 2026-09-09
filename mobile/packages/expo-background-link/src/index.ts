import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

/** Task key the native service starts; JS must `AppRegistry.registerHeadlessTask` it. */
export const BACKGROUND_LINK_TASK_KEY = 'CodeUIBackgroundLink'

type NativeBackgroundLink = {
  start(title: string, text: string): void
  update(title: string, text: string): void
  stop(): void
  isRunning(): boolean
  isIgnoringBatteryOptimizations(): boolean
  requestIgnoreBatteryOptimizations(): boolean
}

// Why optional: the module is Android-only and absent from iOS, web and the
// vitest runtime. Every entry point below degrades to a no-op there.
const native: NativeBackgroundLink | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeBackgroundLink>('BackgroundLink') : null

export const isBackgroundLinkSupported = native !== null

/** Start (or refresh) the foreground service. Call only while the app is in the foreground. */
export function startBackgroundLink(title: string, text: string): void {
  native?.start(title, text)
}

export function updateBackgroundLink(title: string, text: string): void {
  native?.update(title, text)
}

export function stopBackgroundLink(): void {
  native?.stop()
}

export function isBackgroundLinkRunning(): boolean {
  return native?.isRunning() ?? false
}

/** True when Android will not Doze this app's network — the "Unrestricted"
 *  battery setting. Platforms without the module report true: nothing to lift. */
export function isBackgroundLinkUnrestricted(): boolean {
  return native?.isIgnoringBatteryOptimizations() ?? true
}

/** Opens the system prompt (or the optimisation list) for the exemption.
 *  Returns false when the OS offered no screen to open. */
export function requestBackgroundLinkUnrestricted(): boolean {
  return native?.requestIgnoreBatteryOptimizations() ?? false
}
