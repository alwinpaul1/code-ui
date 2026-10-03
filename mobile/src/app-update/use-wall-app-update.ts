import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'

import { normalizeCodeUiReleaseUrl } from './code-ui-release-url'
import { evaluateUpdate, type UpdateCheckResult } from './check-update'
import { LAST_AVAILABLE_KEY, useAppUpdateStore } from './app-update-store'
import { getInstalledBuildNumber, getInstalledVersion } from './installed-version'

/** The newest release of this app that the update check has found: its version and its own page. */
export type WallAppUpdate = { version: string; releaseUrl: string }

async function readRememberedRelease(): Promise<WallAppUpdate | null> {
  const raw = await AsyncStorage.getItem(LAST_AVAILABLE_KEY).catch(() => null)
  if (!raw) {
    return null
  }
  let stored: UpdateCheckResult
  try {
    stored = JSON.parse(raw) as UpdateCheckResult
  } catch {
    return null
  }
  const releaseUrl =
    stored.status === 'available' ? normalizeCodeUiReleaseUrl(stored.releaseUrl) : null
  if (stored.status !== 'available' || releaseUrl === null) {
    return null
  }
  // A release the installed build has caught up with is no way past a wall.
  const stillNewer =
    evaluateUpdate({
      installedVersion: getInstalledVersion(),
      installedBuildNumber: getInstalledBuildNumber(),
      candidates: [
        {
          version: stored.latestVersion,
          buildNumber: stored.latestBuildNumber,
          releaseNotes: stored.releaseNotes,
          updateUrl: stored.updateUrl,
          releaseUrl: stored.releaseUrl
        }
      ]
    }).status === 'available'
  return stillNewer ? { version: stored.latestVersion, releaseUrl } : null
}

/**
 * The release the update check already knows, for the compat wall. It starts no check: the
 * checker's own cadence (cold start, foreground, its timer) already runs before a wall can show.
 *
 * Why the remembered copy too: "Later" on the home card clears the store's release, but a wall
 * is not a nudge the user declined, so the release the check last found still counts here.
 */
export function useWallAppUpdate(): WallAppUpdate | null {
  const version = useAppUpdateStore((state) => state.latestVersion)
  const releaseUrl = useAppUpdateStore((state) => state.releaseUrl)
  const [remembered, setRemembered] = useState<WallAppUpdate | null>(null)
  const storeReleaseUrl = normalizeCodeUiReleaseUrl(releaseUrl)
  const inStore = version !== null && storeReleaseUrl !== null
  useEffect(() => {
    if (inStore) {
      return
    }
    let cancelled = false
    void readRememberedRelease().then((release) => {
      if (!cancelled) {
        setRemembered(release)
      }
    })
    return () => {
      cancelled = true
    }
  }, [inStore])
  return inStore ? { version, releaseUrl: storeReleaseUrl } : remembered
}
