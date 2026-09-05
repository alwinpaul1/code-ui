import { Platform } from 'react-native'
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  evaluateUpdate,
  performUpdateCheck,
  shouldRunUpdateCheck,
  type UpdateCheckResult,
  type UpdateStatus
} from './check-update'
import { getUpdateDismissalId, isUpdateDismissed } from './dismissed-update-id'
import { getInstalledBuildNumber, getInstalledVersion } from './installed-version'

// App-update feature store (ported from Orca Mobile's Android update check).
//
// Why zustand: a tiny global store without threading a Context provider
// through the tree. The update card subscribes to slices of this; the
// download/install phases live in apk-install-store.ts.
//
// Throttle + dismissal persist in AsyncStorage so a daily check cadence and a
// "Later" tap survive cold starts. The pure decision logic lives in
// check-update.ts (unit-tested); this module only wires it to device storage.

const LAST_CHECK_KEY = 'codeui:last-update-check'
const LAST_AVAILABLE_KEY = 'codeui:last-available-update'
// Why 30 minutes: a new release should reach a phone that is opened a few
// times a day within the hour, without polling GitHub on every foreground.
const CHECK_INTERVAL_MS = 30 * 60 * 1000
const REQUEST_TIMEOUT_MS = 12_000

// Why: status flips after async storage reads, so block overlapping focus events
// before the first await can let another check enter.
let updateCheckInFlight = false

export type AppUpdateState = {
  status: UpdateStatus
  latestVersion: string | null
  latestBuildNumber: string | null
  releaseNotes: string | null
  updateUrl: string | null
  releaseUrl: string | null
  dismissedUpdateId: string | null
  /** True while the current status came from a "Check for updates" tap, so the
   *  card may show the transient checking / up-to-date states like desktop Orca. */
  userInitiated: boolean

  /** Run a throttled update check (unless force:true). No-op if one is running. */
  checkForUpdate: (opts?: { force?: boolean }) => Promise<void>
  /** Dismiss the currently surfaced update so it won't reappear until the next update id. */
  dismiss: () => Promise<void>
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  status: 'idle',
  latestVersion: null,
  latestBuildNumber: null,
  releaseNotes: null,
  updateUrl: null,
  releaseUrl: null,
  dismissedUpdateId: null,
  userInitiated: false,

  checkForUpdate: async (opts) => {
    if (updateCheckInFlight || get().status === 'checking') {
      return
    }
    updateCheckInFlight = true

    try {
      const lastCheckRaw = await AsyncStorage.getItem(LAST_CHECK_KEY).catch(() => null)
      const lastCheckAtMs = lastCheckRaw ? Number(lastCheckRaw) : null
      const now = Date.now()
      if (
        !shouldRunUpdateCheck({
          force: opts?.force,
          hasInMemoryResult: get().status !== 'idle',
          now,
          lastCheckAtMs,
          intervalMs: CHECK_INTERVAL_MS
        })
      ) {
        return
      }

      // Why: capture the pre-check status before overwriting it. On a transient
      // network failure we restore it below so a previously-known update stays
      // visible instead of being yanked for up to 24h (the throttle still
      // advanced).
      const wasAvailable = get().status === 'available'
      set({ status: 'checking', userInitiated: Boolean(opts?.force) })

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      let result
      try {
        result = await performUpdateCheck({
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
          installedVersion: getInstalledVersion(),
          installedBuildNumber: getInstalledBuildNumber(),
          signal: controller.signal
        })
      } catch {
        // Why: performUpdateCheck is designed never to reject (sources catch
        // internally and the abort-timeout path surfaces as status 'error'), so
        // this is a defensive net against a future regression that throws — it
        // keeps the store from sticking on 'checking' instead of a user-visible
        // failure to resolve.
        result = { status: 'error' as const }
      } finally {
        clearTimeout(timer)
      }

      // One line per check so a silent "no card" is diagnosable from logcat /
      // the connection log without a debug build.
      console.log('[app-update] check', {
        installed: `${getInstalledVersion()} (${getInstalledBuildNumber() ?? '?'})`,
        result
      })
      // Why: advance the throttle on any completion so a failed attempt today
      // doesn't immediately retry on the next screen focus.
      void AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now())).catch(() => {})

      // Why: read the persisted dismissed update id fresh on every check so a
      // "Later" tap from this or a prior session always suppresses the right
      // version — regardless of whether hydrateAppUpdateState has run yet (it
      // races the first check on cold start).

      set((state) => {
        if (result.status === 'error') {
          // Why: keep a previously-known update visible across a transient
          // network blip instead of yanking the banner away. latestVersion /
          // releaseNotes / updateUrl are still in state (only status was flipped
          // to 'checking'), so restoring the status is enough.
          if (wasAvailable) {
            return { status: 'available' }
          }
          return { status: 'error' }
        }
        if (result.status === 'up-to-date') {
          void AsyncStorage.removeItem(LAST_AVAILABLE_KEY).catch(() => {})
          return {
            status: 'up-to-date',
            latestVersion: null,
            latestBuildNumber: null,
            releaseNotes: null,
            updateUrl: null,
            releaseUrl: null
          }
        }
        // result.status === 'available'
        // Why: suppress against EITHER source. dismiss() updates the store
        // synchronously before its fire-and-forget persist lands, so an in-flight
        // check reading storage could see a stale value; state.dismissedUpdateId
        // is always current the instant the user taps "Later".
        const resultUpdate = {
          version: result.latestVersion,
          buildNumber: result.latestBuildNumber,
          updateUrl: result.updateUrl
        }
        const suppress = isUpdateDismissed(state.dismissedUpdateId, resultUpdate)
        // Why persisted: a cold start shows the dialog from this before the
        // network answers, which is what makes "every open until installed" hold.
        void AsyncStorage.setItem(LAST_AVAILABLE_KEY, JSON.stringify(result)).catch(() => {})
        if (suppress) {
          return {
            status: 'up-to-date',
            latestVersion: null,
            latestBuildNumber: null,
            releaseNotes: null,
            updateUrl: null,
            releaseUrl: null
          }
        }
        return {
          status: 'available',
          latestVersion: result.latestVersion,
          latestBuildNumber: result.latestBuildNumber ?? null,
          releaseNotes: result.releaseNotes ?? null,
          updateUrl: result.updateUrl ?? null,
          releaseUrl: result.releaseUrl ?? null
        }
      })
    } finally {
      updateCheckInFlight = false
    }
  },

  dismiss: async () => {
    const latestVersion = get().latestVersion
    if (!latestVersion) {
      return
    }
    const dismissedUpdateId = getUpdateDismissalId({
      version: latestVersion,
      buildNumber: get().latestBuildNumber,
      updateUrl: get().updateUrl
    })
    // Why not persisted: "Later" hides the dialog for this app session only.
    // The next open shows it again until the update is installed.
    set({
      dismissedUpdateId,
      status: 'up-to-date',
      latestVersion: null,
      latestBuildNumber: null,
      releaseNotes: null,
      updateUrl: null,
      releaseUrl: null,
      userInitiated: false
    })
  }
}))

/**
 * Restore the last update the phone found, so a cold start shows the dialog
 * at once; the next check confirms or clears it. Skipped once the installed
 * build has caught up.
 */
export async function hydrateAppUpdateState(): Promise<void> {
  const raw = await AsyncStorage.getItem(LAST_AVAILABLE_KEY).catch(() => null)
  if (!raw) {
    return
  }
  let stored: UpdateCheckResult
  try {
    stored = JSON.parse(raw) as UpdateCheckResult
  } catch {
    return
  }
  if (stored.status !== 'available' || useAppUpdateStore.getState().status !== 'idle') {
    return
  }
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
  if (!stillNewer) {
    void AsyncStorage.removeItem(LAST_AVAILABLE_KEY).catch(() => {})
    return
  }
  useAppUpdateStore.setState({
    status: 'available',
    latestVersion: stored.latestVersion,
    latestBuildNumber: stored.latestBuildNumber ?? null,
    releaseNotes: stored.releaseNotes ?? null,
    updateUrl: stored.updateUrl ?? null,
    releaseUrl: stored.releaseUrl ?? null
  })
}
