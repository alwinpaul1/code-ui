import type { ApkUpdateState } from '@codeui/expo-apk-updater'

/** What the install dialog shows. `ready` means Android still wants a tap. */
export type ApkInstallPhase = 'idle' | 'downloading' | 'installing' | 'ready' | 'failed'

/**
 * The native updater's phase, as the dialog understands it. A finished
 * download is `ready`: the person asked to be ASKED before an install
 * restarts the app, so the file waits for the Install button (2026-09-12).
 * `pending-user-action` is ready too — Install shows Android's sheet.
 * `installing` from a cold start is also ready: the process that was
 * committing died without the OS replacing the app, so the commit never
 * finished; a live install keeps its spinner because the store sets that
 * phase itself.
 */
export function phaseFromUpdaterState(
  state: ApkUpdateState | null,
  options: { coldStart?: boolean } = {}
): ApkInstallPhase {
  switch (state?.phase) {
    case 'downloading':
      return 'downloading'
    case 'downloaded':
    case 'pending-user-action':
      return 'ready'
    case 'installing':
      return options.coldStart ? 'ready' : 'installing'
    case 'failed':
      return 'failed'
    default:
      return 'idle'
  }
}
