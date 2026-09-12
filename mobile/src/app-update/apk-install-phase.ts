import type { ApkUpdateState } from '@codeui/expo-apk-updater'

/** What the install dialog shows. `ready` means Android still wants a tap. */
export type ApkInstallPhase = 'idle' | 'downloading' | 'installing' | 'ready' | 'failed'

/**
 * The native updater's phase, as the dialog understands it. `downloaded` and
 * `installing` both read as installing: the download-complete receiver commits
 * the install the moment the file lands, so there is no user step between
 * them. `pending-user-action` is the one state that needs the person.
 */
export function phaseFromUpdaterState(state: ApkUpdateState | null): ApkInstallPhase {
  switch (state?.phase) {
    case 'downloading':
      return 'downloading'
    case 'downloaded':
    case 'installing':
      return 'installing'
    case 'pending-user-action':
      return 'ready'
    case 'failed':
      return 'failed'
    default:
      return 'idle'
  }
}
