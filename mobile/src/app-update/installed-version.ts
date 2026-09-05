import * as Application from 'expo-application'
import Constants from 'expo-constants'
import { Platform } from 'react-native'

// Thin adapter over the native app identity so the rest of the app-update module
// stays pure and unit-testable without pulling native Expo modules into vitest.
//
// Why expo-application first: expo-constants' version fields come from the config
// embedded in the JS bundle, i.e. whatever app.json said when the bundle was
// built. A build whose native versionName differs (a local test build, a stale
// prebuild) would then compare the wrong number and never see an update.
// expo-application reads PackageInfo / CFBundle on the installed binary.

/** Read the installed marketing version. Defaults to 0.0.0. */
export function getInstalledVersion(): string {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0'
}

/** Read the installed native build identifier used to break same-version ties. */
export function getInstalledBuildNumber(): string | null {
  if (Application.nativeBuildVersion) {
    return Application.nativeBuildVersion
  }
  if (Platform.OS === 'ios') {
    return Constants.platform?.ios?.buildNumber ?? Constants.expoConfig?.ios?.buildNumber ?? null
  }
  const versionCode =
    Constants.platform?.android?.versionCode ?? Constants.expoConfig?.android?.versionCode
  return versionCode === undefined ? null : String(versionCode)
}
