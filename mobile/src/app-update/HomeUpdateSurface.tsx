import { AppUpdateDialog } from './AppUpdateDialog'
import { HomeUpdateDownloadCard } from './HomeUpdateDownloadCard'
import { useHomeUpdateCheck } from './use-home-update-check'

export function HomeUpdateSurface() {
  // Why: Home focus owns update polling; the card subscribes separately so the
  // Home screen does not need update-specific state.
  useHomeUpdateCheck()

  // The two are never up together: a download hides the dialog, and the
  // download card is gone the moment the download is.
  return (
    <>
      <HomeUpdateDownloadCard />
      <AppUpdateDialog />
    </>
  )
}
