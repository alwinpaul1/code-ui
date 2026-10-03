import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useState } from 'react'

import { evaluateUpdate, type UpdateCheckResult } from './check-update'
import { LAST_AVAILABLE_KEY, useAppUpdateStore } from './app-update-store'
import { getInstalledBuildNumber, getInstalledVersion } from './installed-version'

/** The newest release of this app that the update check has found: its version and its own page. */
export type WallAppUpdate = { version: string; releaseUrl: string }

/** Where this app's APKs are published. A release link from anywhere else is never opened. */
const CODE_UI_RELEASE_PAGE_PREFIX = 'https://github.com/alwinpaul1/code-ui/releases'

function isCodeUiReleasePage(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    (url === CODE_UI_RELEASE_PAGE_PREFIX || url.startsWith(`${CODE_UI_RELEASE_PAGE_PREFIX}/`))
  )
}

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
  if (stored.status !== 'available' || !isCodeUiReleasePage(stored.releaseUrl)) {
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
  return stillNewer ? { version: stored.latestVersion, releaseUrl: stored.releaseUrl } : null
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
  const inStore = version !== null && isCodeUiReleasePage(releaseUrl)
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
  return inStore ? { version, releaseUrl } : remembered
}
