import { useAppUpdateStore } from './app-update-store'
import { useApkInstallStore } from './apk-install-store'

// The one state machine behind the update dialog: check store + install store
// folded into what the card shows. Kept apart from the JSX so the dialog file
// stays under the lint ceiling and the fold is readable on its own.

export type DialogState =
  | { kind: 'hidden' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'check-failed' }
  | { kind: 'available' }
  | { kind: 'downloading'; progress: number; background: boolean }
  | { kind: 'installing' }
  | { kind: 'ready' }
  | { kind: 'failed'; error: string }

export function useDialogState(): DialogState {
  const status = useAppUpdateStore((s) => s.status)
  const latestVersion = useAppUpdateStore((s) => s.latestVersion)
  const userInitiated = useAppUpdateStore((s) => s.userInitiated)
  const phase = useApkInstallStore((s) => s.phase)
  const progress = useApkInstallStore((s) => s.progress)
  const error = useApkInstallStore((s) => s.error)
  const background = useApkInstallStore((s) => s.background)

  if (phase === 'downloading') {
    return { kind: 'downloading', progress, background }
  }
  if (phase === 'installing') {
    return { kind: 'installing' }
  }
  if (phase === 'ready') {
    return { kind: 'ready' }
  }
  if (phase === 'failed') {
    return { kind: 'failed', error: error ?? 'Something went wrong.' }
  }
  if (status === 'available' && latestVersion) {
    return { kind: 'available' }
  }
  if (userInitiated && status === 'checking') {
    return { kind: 'checking' }
  }
  if (userInitiated && status === 'up-to-date') {
    return { kind: 'up-to-date' }
  }
  if (userInitiated && status === 'error') {
    return { kind: 'check-failed' }
  }
  return { kind: 'hidden' }
}

/** Whether a dialog is on screen right now, for a host screen that must stop
 *  taking touches while it closes. */
export function useAppUpdateDialogVisible(): boolean {
  return useDialogState().kind !== 'hidden'
}
