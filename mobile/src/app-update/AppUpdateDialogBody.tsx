import { useMemo, type ReactNode } from 'react'
import { ActivityIndicator, Linking, View } from 'react-native'

import { useTheme } from '../theme/theme-context'
import { AlertActionRow } from '../ui/alert/AlertActionRow'
import { AlertMessage, AlertScrollRegion, AlertTextBlock, AlertTitle } from '../ui/alert/AlertText'
import { useAppUpdateStore } from './app-update-store'
import { useApkInstallStore } from './apk-install-store'
import type { DialogState } from './app-update-dialog-state'
import { AppUpdateReleaseNotes } from './AppUpdateReleaseNotes'
import { getInstalledVersion } from './installed-version'
import { releaseNotesMarkdown } from './release-notes-markdown'

// What the alert says in each state: a title, a message, and the rows under
// them. The rows are UIAlertController's: the action the alert exists for is
// preferred (semibold) and sits first; the way out is always last. The
// machinery behind the rows (check, download, install) is the stores'.
//
// The copy of `up-to-date` and `check-failed` is what About → "Check for
// updates" shows, the path most people take; it is the copy that shipped,
// pinned in AppUpdateDialog.test.tsx, not restyled with the card.

function Spinner() {
  const { colors, space } = useTheme()
  return (
    <ActivityIndicator
      size="small"
      color={colors.textSecondary}
      style={{ marginTop: space.md }}
    />
  )
}

/** The card's column: shrinks with the screen so the rows stay reachable;
 *  inside it only a scroll region gives way. */
function Column({ children }: { children: ReactNode }) {
  return <View style={{ flexShrink: 1 }}>{children}</View>
}

export function AppUpdateDialogBody({
  state,
  onDismiss
}: {
  state: DialogState
  onDismiss: () => void
}) {
  const latestVersion = useAppUpdateStore((s) => s.latestVersion)
  const releaseNotes = useAppUpdateStore((s) => s.releaseNotes)
  const releaseUrl = useAppUpdateStore((s) => s.releaseUrl)
  const updateUrl = useAppUpdateStore((s) => s.updateUrl)
  const startInstall = useApkInstallStore((s) => s.start)
  const reopenInstaller = useApkInstallStore((s) => s.install)
  const installVersion = useApkInstallStore((s) => s.version)
  const version = installVersion ?? latestVersion ?? ''
  const installedVersion = getInstalledVersion()
  // Memoised on the body so the renderer's parse cache keys on one string.
  const notes = useMemo(() => releaseNotesMarkdown(releaseNotes), [releaseNotes])

  switch (state.kind) {
    case 'checking':
      return (
        <AlertTextBlock>
          <AlertTitle>Checking for updates</AlertTitle>
          <Spinner />
        </AlertTextBlock>
      )
    case 'up-to-date':
      return (
        <Column>
          <AlertTextBlock>
            <AlertTitle>You're up to date</AlertTitle>
            <AlertMessage>Code UI {installedVersion} is the latest version.</AlertMessage>
          </AlertTextBlock>
          <AlertActionRow label="Done" preferred onPress={onDismiss} />
        </Column>
      )
    case 'check-failed':
      return (
        <Column>
          <AlertTextBlock>
            <AlertTitle>Could not check for updates</AlertTitle>
            <AlertMessage>Check the connection and try again in a moment.</AlertMessage>
          </AlertTextBlock>
          <AlertActionRow label="OK" preferred onPress={onDismiss} />
        </Column>
      )
    case 'available':
      return (
        <Column>
          <AlertTextBlock closed={!notes}>
            <AlertTitle>Update available</AlertTitle>
            <AlertMessage>
              Code UI {version} is ready to download. You have {installedVersion}.
            </AlertMessage>
            {notes ? null : <AlertMessage>Fixes and improvements.</AlertMessage>}
          </AlertTextBlock>
          {notes ? <AppUpdateReleaseNotes markdown={notes} /> : null}
          {updateUrl ? (
            <AlertActionRow
              label="Update now"
              preferred
              onPress={() => void startInstall({ url: updateUrl, version })}
            />
          ) : null}
          {releaseUrl ? (
            <AlertActionRow
              label="View on GitHub"
              onPress={() => void Linking.openURL(releaseUrl).catch(() => {})}
            />
          ) : null}
          <AlertActionRow label="Later" onPress={onDismiss} />
        </Column>
      )
    case 'installing':
      return (
        <AlertTextBlock>
          <AlertTitle>Installing</AlertTitle>
          <Spinner />
        </AlertTextBlock>
      )
    case 'ready':
      return (
        <Column>
          <AlertTextBlock>
            <AlertTitle>Update downloaded</AlertTitle>
            <AlertMessage>
              Code UI {version} is ready to install. Your paired desktops and settings stay as
              they are.
            </AlertMessage>
          </AlertTextBlock>
          <AlertActionRow label="Install" preferred onPress={() => void reopenInstaller()} />
          <AlertActionRow label="Later" onPress={() => useApkInstallStore.getState().reset()} />
        </Column>
      )
    case 'failed':
      return (
        <Column>
          <AlertTextBlock closed={false}>
            <AlertTitle>Update failed</AlertTitle>
          </AlertTextBlock>
          {/* The error is whatever the download or installer said, any
              length; it scrolls rather than pushing the rows off a small
              screen. */}
          <AlertScrollRegion>
            <AlertMessage>{state.error}</AlertMessage>
          </AlertScrollRegion>
          {updateUrl ? (
            <AlertActionRow
              label="Try again"
              preferred
              onPress={() => void startInstall({ url: updateUrl, version })}
            />
          ) : null}
          <AlertActionRow label="Not now" onPress={onDismiss} />
        </Column>
      )
    default:
      return null
  }
}
