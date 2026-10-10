import { AlertTriangle, CheckCircle2, CloudOff } from 'lucide-react-native'
import { useMemo } from 'react'
import { ActivityIndicator, View } from 'react-native'

import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { useAppUpdateStore } from './app-update-store'
import { useApkInstallStore } from './apk-install-store'
import type { DialogState } from './app-update-dialog-state'
import { AppUpdateReleaseNotes } from './AppUpdateReleaseNotes'
import { getInstalledVersion } from './installed-version'
import { releaseNoteGroups } from './release-notes-groups'
import { releaseNotesMarkdown } from './release-notes-markdown'
import {
  UpdateActionBar,
  UpdateColumn,
  UpdateDivider,
  UpdateHero,
  UpdateScrollRegion,
  UpdateStatusHeader
} from './update-card-parts'

// What the update card says in each state (2026-10-10 redesign). A state
// that offers a version leads with it, large; every other state leads with an
// icon and a title. The action the card exists for is the accent pill; the
// way out is the quiet button under it. The machinery behind the buttons
// (check, download, install) is the stores', untouched by the redesign.
//
// The copy of `up-to-date` and `check-failed` is what About → "Check for
// updates" shows, the path most people take; it is the copy that shipped,
// pinned in AppUpdateDialog.test.tsx.

function Spinner() {
  const { colors } = useTheme()
  return <ActivityIndicator size="small" color={colors.textSecondary} />
}

export function AppUpdateDialogBody({
  state,
  onDismiss
}: {
  state: DialogState
  onDismiss: () => void
}) {
  const { colors, radius, space } = useTheme()
  const latestVersion = useAppUpdateStore((s) => s.latestVersion)
  const releaseNotes = useAppUpdateStore((s) => s.releaseNotes)
  const updateUrl = useAppUpdateStore((s) => s.updateUrl)
  const startInstall = useApkInstallStore((s) => s.start)
  const reopenInstaller = useApkInstallStore((s) => s.install)
  const installVersion = useApkInstallStore((s) => s.version)
  const version = installVersion ?? latestVersion ?? ''
  const installedVersion = getInstalledVersion()
  // Memoised on the body so the renderer's parse cache keys on one string.
  const notes = useMemo(() => releaseNotesMarkdown(releaseNotes), [releaseNotes])
  const groups = useMemo(() => releaseNoteGroups(releaseNotes), [releaseNotes])
  const retry = updateUrl
    ? { label: 'Try again', onPress: () => void startInstall({ url: updateUrl, version }) }
    : null

  switch (state.kind) {
    case 'checking':
      return (
        <UpdateStatusHeader tone="muted" accessory={<Spinner />} title="Checking for updates" />
      )
    case 'up-to-date':
      return (
        <UpdateColumn>
          <UpdateStatusHeader
            icon={CheckCircle2}
            tone="success"
            title="You're up to date"
            message={`Code UI ${installedVersion} is the latest version.`}
          />
          <UpdateActionBar primary={{ label: 'Done', onPress: onDismiss }} />
        </UpdateColumn>
      )
    case 'check-failed':
      return (
        <UpdateColumn>
          <UpdateStatusHeader
            icon={CloudOff}
            tone="muted"
            title="Could not check for updates"
            message="Check the connection and try again in a moment."
          />
          <UpdateActionBar primary={{ label: 'OK', onPress: onDismiss }} />
        </UpdateColumn>
      )
    case 'available':
      return (
        <UpdateColumn>
          <UpdateHero
            eyebrow="Update available"
            version={version}
            meta={`Code UI · you have ${installedVersion}`}
          >
            {notes ? null : (
              <Txt variant="body" tone="secondary" style={{ marginTop: space.sm }}>
                Fixes and improvements.
              </Txt>
            )}
          </UpdateHero>
          {notes ? <UpdateDivider /> : null}
          {notes ? <AppUpdateReleaseNotes markdown={notes} groups={groups} /> : null}
          <UpdateActionBar
            divided={Boolean(notes)}
            primary={
              updateUrl
                ? { label: 'Update now', onPress: () => void startInstall({ url: updateUrl, version }) }
                : null
            }
            secondary={{ label: 'Later', onPress: onDismiss }}
          />
        </UpdateColumn>
      )
    case 'installing':
      return (
        <UpdateStatusHeader
          tone="accent"
          accessory={<ActivityIndicator size="small" color={colors.accentText} />}
          title="Installing"
          message={`Android is installing Code UI ${version}. The app may close for a moment while it is replaced.`}
        />
      )
    case 'ready':
      return (
        <UpdateColumn>
          <UpdateHero
            eyebrow="Update downloaded"
            version={version}
            meta={`Ready to install · you have ${installedVersion}`}
          >
            <Txt variant="body" tone="secondary" style={{ marginTop: space.sm }}>
              Your paired desktops and settings stay as they are.
            </Txt>
          </UpdateHero>
          <UpdateActionBar
            primary={{ label: 'Install', onPress: () => void reopenInstaller() }}
            secondary={{ label: 'Later', onPress: () => useApkInstallStore.getState().reset() }}
          />
        </UpdateColumn>
      )
    case 'failed':
      return (
        <UpdateColumn>
          <UpdateStatusHeader
            icon={AlertTriangle}
            tone="danger"
            title="Update failed"
            message={`${version ? `Code UI ${version}` : 'The update'} did not install. Nothing on this phone changed.`}
          />
          <UpdateDivider />
          {/* The reason is whatever the download or installer said, any
              length; it scrolls rather than pushing the buttons off a small
              screen. */}
          <UpdateScrollRegion>
            <View
              testID="update-failure-reason"
              style={{
                backgroundColor: colors.bgSunken,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: space.md + 2,
                paddingVertical: space.md
              }}
            >
              <Txt variant="caption" weight="semibold" tone="muted" style={{ marginBottom: space.xs }}>
                Reason
              </Txt>
              <Txt variant="label" tone="secondary" selectable>
                {state.error}
              </Txt>
            </View>
          </UpdateScrollRegion>
          <UpdateActionBar divided primary={retry} secondary={{ label: 'Not now', onPress: onDismiss }} />
        </UpdateColumn>
      )
    case 'hidden':
      return null
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}
