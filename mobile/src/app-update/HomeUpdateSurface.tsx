import { AppUpdateDialog } from './AppUpdateDialog'
import { useHomeUpdateCheck } from './use-home-update-check'

export function HomeUpdateSurface() {
  // Why: Home focus owns update polling; the card subscribes separately so the
  // Home screen does not need update-specific state.
  useHomeUpdateCheck()

  return <AppUpdateDialog />
}
