import { AppState } from 'react-native'
import { create } from 'zustand'
import {
  addApkUpdateProgressListener,
  addApkUpdateStatusListener,
  clearApkUpdateState,
  getApkUpdateState,
  hasPendingInstallUserAction,
  installDownloadedApk,
  isApkUpdaterAvailable,
  launchPendingInstallUserAction,
  startApkUpdate,
  type ApkUpdateState
} from '@codeui/expo-apk-updater'

import { downloadApk, openApkInstaller } from './android-apk-install'
import { phaseFromUpdaterState, type ApkInstallPhase } from './apk-install-phase'

// Download → install phases for an Android update, separate from the check
// store so the check logic stays pure and small. The card morphs through these
// phases the way Orca desktop's UpdateCard does (available → downloading →
// installing / ready / error).
//
// Two engines. With the native updater present (every Android build since
// 0.5.7) the download is DownloadManager's and the install is a
// PackageInstaller session: both outlive the app, so closing Code UI mid-way
// changes nothing — the update lands on its own, and on Android 12+ with no
// confirmation tap. Without it (iOS, tests, older shells) the store falls back
// to an in-process download handed to the system installer.

export type { ApkInstallPhase }

export type ApkInstallState = {
  phase: ApkInstallPhase
  /** 0..1 while downloading. */
  progress: number
  version: string | null
  fileUri: string | null
  error: string | null
  /** True when the download and install survive the app being closed. */
  background: boolean
  /** Download the APK for `version` from `url`, then install. */
  start: (input: { url: string; version: string }) => Promise<void>
  /** Show the confirmation Android asked for, or re-commit a downloaded APK. */
  install: () => Promise<void>
  reset: () => void
}

let downloadInFlight = false
let listening = false

function applyUpdaterState(state: ApkUpdateState | null, options: { coldStart?: boolean } = {}): void {
  const phase = phaseFromUpdaterState(state, options)
  useApkInstallStore.setState({
    phase,
    version: state?.version ?? null,
    error: phase === 'failed' ? (state?.message ?? 'Something went wrong.') : null,
    background: true,
    ...(phase === 'idle' ? { progress: 0 } : {}),
    ...(phase === 'installing' ? { progress: 1 } : {})
  })
  // Why: the confirmation Android asked for can only be shown by a foreground
  // Activity. If the app is in front when it arrives, show it at once; if not,
  // the dialog's Install button shows it on the next open.
  if (state?.phase === 'pending-user-action' && AppState.currentState === 'active') {
    launchPendingInstallUserAction()
  }
}

function listenToUpdater(): void {
  if (listening || !isApkUpdaterAvailable) {
    return
  }
  listening = true
  addApkUpdateProgressListener((progress) => {
    useApkInstallStore.setState({ progress })
  })
  addApkUpdateStatusListener((state) => {
    applyUpdaterState(state)
  })
}

export const useApkInstallStore = create<ApkInstallState>((set, get) => ({
  phase: 'idle',
  progress: 0,
  version: null,
  fileUri: null,
  error: null,
  background: isApkUpdaterAvailable,

  start: async ({ url, version }) => {
    if (downloadInFlight) {
      return
    }
    downloadInFlight = true
    set({ phase: 'downloading', progress: 0, version, fileUri: null, error: null })
    try {
      if (isApkUpdaterAvailable) {
        listenToUpdater()
        const state = await startApkUpdate(url, version)
        applyUpdaterState(state)
        return
      }
      const fileUri = await downloadApk({
        url,
        version,
        onProgress: (fraction) => set({ progress: fraction })
      })
      set({ phase: 'ready', progress: 1, fileUri, background: false })
    } catch (error) {
      set({ phase: 'failed', error: describeError(error) })
      return
    } finally {
      downloadInFlight = false
    }
    await get().install()
  },

  install: async () => {
    if (isApkUpdaterAvailable) {
      if (hasPendingInstallUserAction()) {
        launchPendingInstallUserAction()
        return
      }
      set({ phase: 'installing', progress: 1, error: null })
      if (!installDownloadedApk()) {
        applyUpdaterState(getApkUpdateState())
      }
      return
    }
    const fileUri = get().fileUri
    if (!fileUri) {
      return
    }
    try {
      await openApkInstaller(fileUri)
    } catch (error) {
      set({ phase: 'failed', error: describeError(error) })
    }
  },

  reset: () => {
    clearApkUpdateState()
    set({ phase: 'idle', progress: 0, version: null, fileUri: null, error: null })
  }
}))

/**
 * On launch, pick up an update that moved while the app was closed: a
 * download still running (the bar resumes), one that finished and now waits
 * for a tap, or one that failed. Nothing to do when the updater is absent or
 * idle.
 */
export function hydrateApkInstallState(): void {
  if (!isApkUpdaterAvailable) {
    return
  }
  listenToUpdater()
  const state = getApkUpdateState()
  if (phaseFromUpdaterState(state, { coldStart: true }) !== 'idle') {
    applyUpdaterState(state, { coldStart: true })
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim() || 'Something went wrong.'
}
