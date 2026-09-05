import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  Linking,
  Modal,
  Pressable,
  View
} from 'react-native'
import { ExternalLink } from 'lucide-react-native'

import { AppUpdateDialogHeader as DialogHeader } from './AppUpdateDialogHeader'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { Button } from '../ui/Button'
import { useAppUpdateStore } from './app-update-store'
import { useApkInstallStore } from './apk-install-store'
import { getInstalledVersion } from './installed-version'
import { releaseNotesExcerpt } from './release-notes-excerpt'

// One centered dialog for the whole update journey, after the update dialogs
// of Flighty (app tile + version), Xbox ("What's new" list) and Rivian
// (underlined "see what's new" link, one primary action) on Mobbin. The same
// container morphs through checking → latest / available → downloading →
// ready → error instead of stacking banners, the shape Orca desktop's
// UpdateCard has. Transient states (checking, up to date) only show for a
// user-initiated "Check for updates".

type DialogState =
  | { kind: 'hidden' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'check-failed' }
  | { kind: 'available' }
  | { kind: 'downloading'; progress: number }
  | { kind: 'ready' }
  | { kind: 'failed'; error: string }

function useDialogState(): DialogState {
  const status = useAppUpdateStore((s) => s.status)
  const latestVersion = useAppUpdateStore((s) => s.latestVersion)
  const userInitiated = useAppUpdateStore((s) => s.userInitiated)
  const phase = useApkInstallStore((s) => s.phase)
  const progress = useApkInstallStore((s) => s.progress)
  const error = useApkInstallStore((s) => s.error)

  if (phase === 'downloading') {
    return { kind: 'downloading', progress }
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

export function AppUpdateDialog() {
  const { colors, space, radius } = useTheme()
  const state = useDialogState()
  const visible = state.kind !== 'hidden'
  const reveal = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)
  const previousKind = useRef(state.kind)
  const dismissible =
    state.kind === 'available' ||
    state.kind === 'up-to-date' ||
    state.kind === 'check-failed' ||
    state.kind === 'failed'

  useEffect(() => {
    if (visible) {
      setMounted(true)
    }
    Animated.timing(reveal, {
      toValue: visible ? 1 : 0,
      duration: visible ? 240 : 160,
      easing: visible ? Easing.out(Easing.back(1.2)) : Easing.in(Easing.cubic),
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false)
      }
    })
  }, [visible, reveal])

  // Why: a height change between states (notes → progress bar → ready) eases
  // instead of snapping; that is the "morph".
  if (previousKind.current !== state.kind) {
    previousKind.current = state.kind
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
  }

  const dismiss = () => {
    if (!dismissible) {
      return
    }
    if (state.kind === 'available') {
      void useAppUpdateStore.getState().dismiss()
    } else if (state.kind === 'failed') {
      useApkInstallStore.getState().reset()
    } else {
      useAppUpdateStore.setState({ userInitiated: false })
    }
  }

  if (!mounted) {
    return null
  }

  return (
    <Modal transparent visible statusBarTranslucent onRequestClose={dismiss}>
      <Animated.View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: space.xl,
          backgroundColor: colors.bgOverlay,
          opacity: reveal
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dismissible ? 'Dismiss' : undefined}
          onPress={dismiss}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        />
        <Animated.View
          accessibilityViewIsModal
          accessibilityLiveRegion="polite"
          style={{
            width: '100%',
            maxWidth: 380,
            backgroundColor: colors.bgRaised,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: radius.xl,
            padding: space.xl,
            shadowColor: colors.shadow,
            shadowOpacity: 0.25,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
            elevation: 12,
            transform: [
              { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }
            ]
          }}
        >
          <DialogBody state={state} onDismiss={dismiss} />
        </Animated.View>
      </Animated.View>
    </Modal>
  )
}

function DialogBody({ state, onDismiss }: { state: DialogState; onDismiss: () => void }) {
  const { colors, space } = useTheme()
  const latestVersion = useAppUpdateStore((s) => s.latestVersion)
  const releaseNotes = useAppUpdateStore((s) => s.releaseNotes)
  const releaseUrl = useAppUpdateStore((s) => s.releaseUrl)
  const updateUrl = useAppUpdateStore((s) => s.updateUrl)
  const startInstall = useApkInstallStore((s) => s.start)
  const reopenInstaller = useApkInstallStore((s) => s.install)
  const installVersion = useApkInstallStore((s) => s.version)
  const version = installVersion ?? latestVersion ?? ''
  const installedVersion = getInstalledVersion()

  switch (state.kind) {
    case 'checking':
      return (
        <View style={{ gap: space.lg, alignItems: 'center' }}>
          <DialogHeader version={installedVersion} />
          <Txt variant="title" weight="semibold" align="center">
            Checking for updates
          </Txt>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      )
    case 'up-to-date':
      return (
        <View style={{ gap: space.lg }}>
          <DialogHeader version={installedVersion} tone="success" />
          <View style={{ gap: space.xs }}>
            <Txt variant="title" weight="semibold" align="center">
              You're up to date
            </Txt>
            <Txt variant="body" tone="secondary" align="center">
              Code UI {installedVersion} is the latest version.
            </Txt>
          </View>
          <Button label="Done" variant="secondary" block onPress={onDismiss} />
        </View>
      )
    case 'check-failed':
      return (
        <View style={{ gap: space.lg }}>
          <DialogHeader version={installedVersion} tone="danger" />
          <View style={{ gap: space.xs }}>
            <Txt variant="title" weight="semibold" align="center">
              Could not check for updates
            </Txt>
            <Txt variant="body" tone="secondary" align="center">
              Check the connection and try again in a moment.
            </Txt>
          </View>
          <Button label="OK" variant="secondary" block onPress={onDismiss} />
        </View>
      )
    case 'available': {
      const notes = releaseNotesExcerpt(releaseNotes)
      return (
        <View style={{ gap: space.lg }}>
          <DialogHeader version={version} onClose={onDismiss} />
          <View style={{ gap: space.sm }}>
            <Txt variant="title" weight="semibold" align="center">
              What's new
            </Txt>
            {notes.length > 0 ? (
              notes.map((line) => (
                <Txt key={line} variant="body" tone="secondary">
                  • {line}
                </Txt>
              ))
            ) : (
              <Txt variant="body" tone="secondary" align="center">
                Fixes and improvements.
              </Txt>
            )}
            {releaseUrl ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="See what's new on GitHub"
                onPress={() => void Linking.openURL(releaseUrl)}
                hitSlop={6}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  alignSelf: 'center',
                  gap: 4,
                  marginTop: space.xs,
                  opacity: pressed ? 0.5 : 1
                })}
              >
                <Txt
                  variant="body"
                  weight="medium"
                  tone="accent"
                  style={{ textDecorationLine: 'underline' }}
                >
                  See what's new on GitHub
                </Txt>
                <ExternalLink size={14} color={colors.accentText} />
              </Pressable>
            ) : null}
          </View>
          <View style={{ gap: space.sm }}>
            {updateUrl ? (
              <Button
                label="Update now"
                variant="accent"
                block
                onPress={() => void startInstall({ url: updateUrl, version })}
              />
            ) : null}
            <Button label="Later" variant="ghost" block onPress={onDismiss} />
          </View>
        </View>
      )
    }
    case 'downloading': {
      const percent = Math.round(state.progress * 100)
      return (
        <View style={{ gap: space.lg }}>
          <DialogHeader version={version} />
          <Txt variant="title" weight="semibold" align="center">
            Downloading update
          </Txt>
          <View style={{ gap: space.sm }}>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: percent }}
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.bgSunken,
                overflow: 'hidden'
              }}
            >
              <View
                style={{ width: `${percent}%`, height: '100%', backgroundColor: colors.accent }}
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Txt variant="caption" tone="muted">
                Keep Code UI open
              </Txt>
              <Txt variant="caption" tone="muted">
                {percent}%
              </Txt>
            </View>
          </View>
        </View>
      )
    }
    case 'ready':
      return (
        <View style={{ gap: space.lg }}>
          <DialogHeader version={version} tone="success" />
          <Txt variant="title" weight="semibold" align="center">
            Ready to install
          </Txt>
          <Txt variant="body" tone="secondary" align="center">
            Android asks you to confirm the install. Your paired desktops and settings stay as they
            are.
          </Txt>
          <View style={{ gap: space.sm }}>
            <Button label="Install" variant="accent" block onPress={() => void reopenInstaller()} />
            <Button
              label="Later"
              variant="ghost"
              block
              onPress={() => useApkInstallStore.getState().reset()}
            />
          </View>
        </View>
      )
    case 'failed':
      return (
        <View style={{ gap: space.lg }}>
          <DialogHeader version={version} tone="danger" onClose={onDismiss} />
          <Txt variant="title" weight="semibold" align="center">
            Update failed
          </Txt>
          <Txt variant="body" tone="secondary" align="center">
            {state.error}
          </Txt>
          <View style={{ gap: space.sm }}>
            {updateUrl ? (
              <Button
                label="Try again"
                variant="accent"
                block
                onPress={() => void startInstall({ url: updateUrl, version })}
              />
            ) : null}
            <Button label="Not now" variant="ghost" block onPress={onDismiss} />
          </View>
        </View>
      )
    default:
      return null
  }
}
