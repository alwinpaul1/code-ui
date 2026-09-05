import { create } from 'zustand'

import { downloadApk, openApkInstaller } from './android-apk-install'

// Download → install phases for an Android update, separate from the check
// store so the check logic stays pure and small. The card morphs through these
// phases the way Orca desktop's UpdateCard does (available → downloading →
// ready → installing / error).

export type ApkInstallPhase = 'idle' | 'downloading' | 'ready' | 'failed'

export type ApkInstallState = {
  phase: ApkInstallPhase
  /** 0..1 while downloading. */
  progress: number
  version: string | null
  fileUri: string | null
  error: string | null
  /** Download the APK for `version` from `url`, then open the installer. */
  start: (input: { url: string; version: string }) => Promise<void>
  /** Re-open the installer on an already downloaded APK. */
  install: () => Promise<void>
  reset: () => void
}

let downloadInFlight = false

export const useApkInstallStore = create<ApkInstallState>((set, get) => ({
  phase: 'idle',
  progress: 0,
  version: null,
  fileUri: null,
  error: null,

  start: async ({ url, version }) => {
    if (downloadInFlight) {
      return
    }
    downloadInFlight = true
    set({ phase: 'downloading', progress: 0, version, fileUri: null, error: null })
    try {
      const fileUri = await downloadApk({
        url,
        version,
        onProgress: (fraction) => set({ progress: fraction })
      })
      set({ phase: 'ready', progress: 1, fileUri })
    } catch (error) {
      set({ phase: 'failed', error: describeError(error) })
      return
    } finally {
      downloadInFlight = false
    }
    await get().install()
  },

  install: async () => {
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

  reset: () => set({ phase: 'idle', progress: 0, version: null, fileUri: null, error: null })
}))

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim() || 'Something went wrong.'
}
