import { Platform } from 'react-native'
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { performUpdateCheck, shouldRunUpdateCheck, type UpdateStatus } from './check-update'
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
const DISMISSED_KEY = 'codeui:dismissed-update'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // once per day
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

      // Why: advance the throttle on any completion so a failed attempt today
      // doesn't immediately retry on the next screen focus.
      void AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now())).catch(() => {})

      // Why: read the persisted dismissed update id fresh on every check so a
      // "Later" tap from this or a prior session always suppresses the right
      // version — regardless of whether hydrateAppUpdateState has run yet (it
      // races the first check on cold start).
      const dismissedFromStorage = await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null)

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
        const suppress =
          isUpdateDismissed(dismissedFromStorage, resultUpdate) ||
          isUpdateDismissed(state.dismissedUpdateId, resultUpdate)
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
    void AsyncStorage.setItem(DISMISSED_KEY, dismissedUpdateId).catch(() => {})
  }
}))

/**
 * Hydrate the persisted dismissed update id into the store on cold start so a
 * "Later" tap from a previous session still suppresses that exact update.
 */
export async function hydrateAppUpdateState(): Promise<void> {
  const dismissed = await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null)
  if (dismissed) {
    useAppUpdateStore.setState({ dismissedUpdateId: dismissed })
  }
}
