import { AppUpdateDialog } from './AppUpdateDialog'
import { useHomeUpdateCheck } from './use-home-update-check'

export function HomeUpdateSurface() {
  // Why: Home focus owns update polling. A download shows nothing here (the
  // user removed the progress card 2026-10-11); the dialog returns with
  // Install when the file is in.
  useHomeUpdateCheck()

  return <AppUpdateDialog />
}
