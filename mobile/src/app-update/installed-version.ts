import Constants from 'expo-constants'
import { Platform } from 'react-native'

// Thin adapter over expo-constants so the rest of the app-update module can stay
// pure and unit-testable without pulling a native Expo module into the vitest
// environment. Only this file (and the RN-coupled store) import expo-constants.

/** Read the installed marketing version. Prefers the native binary's version
 *  (versionName / CFBundleShortVersionString): expoConfig.version is whatever
 *  app.json said when the JS bundle was built, which can differ from the APK that
 *  is actually installed. Defaults to 0.0.0. */
export function getInstalledVersion(): string {
  return Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '0.0.0'
}

/** Read the installed native build identifier used to break same-version ties. */
export function getInstalledBuildNumber(): string | null {
  if (Constants.nativeBuildVersion) {
    return String(Constants.nativeBuildVersion)
  }
  if (Platform.OS === 'ios') {
    return Constants.platform?.ios?.buildNumber ?? Constants.expoConfig?.ios?.buildNumber ?? null
  }
  const versionCode =
    Constants.platform?.android?.versionCode ?? Constants.expoConfig?.android?.versionCode
  return versionCode === undefined ? null : String(versionCode)
}
