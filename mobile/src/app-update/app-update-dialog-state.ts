import { useAppUpdateStore } from './app-update-store'
import { useApkInstallStore } from './apk-install-store'
import { resolveDialogState, type DialogState } from './app-update-dialog-state-machine'

// The dialog reads its state through this hook; the pure fold lives in
// app-update-dialog-state-machine.ts so it can be tested without the stores.
export type { DialogState, DialogStateInputs } from './app-update-dialog-state-machine'
export { resolveDialogState } from './app-update-dialog-state-machine'

export function useDialogState(): DialogState {
  const status = useAppUpdateStore((s) => s.status)
  const latestVersion = useAppUpdateStore((s) => s.latestVersion)
  const userInitiated = useAppUpdateStore((s) => s.userInitiated)
  const phase = useApkInstallStore((s) => s.phase)
  const error = useApkInstallStore((s) => s.error)
  return resolveDialogState({ status, latestVersion, userInitiated, phase, error })
}

/** Whether a dialog is on screen right now, for a host screen that must stop
 *  taking touches while it closes. */
export function useAppUpdateDialogVisible(): boolean {
  return useDialogState().kind !== 'hidden'
}
