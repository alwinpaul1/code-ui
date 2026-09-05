import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  Linking,
  Pressable,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AlertCircle, Check, Download, X } from 'lucide-react-native'

import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { Button } from '../ui/Button'
import { useAppUpdateStore } from './app-update-store'
import { useApkInstallStore } from './apk-install-store'
import { releaseNotesExcerpt } from './release-notes-excerpt'

// The phone counterpart of Orca desktop's UpdateCard: one floating card that
// morphs between checking → latest / available → downloading → ready → error
// instead of stacking separate banners. Transient states (checking, up to
// date) only show for a user-initiated "Check for updates", like desktop.

const UP_TO_DATE_AUTO_HIDE_MS = 3000

type CardState =
  | { kind: 'hidden' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'check-failed' }
  | { kind: 'available' }
  | { kind: 'downloading'; progress: number }
  | { kind: 'ready' }
  | { kind: 'failed'; error: string }

function useCardState(): CardState {
  const status = useAppUpdateStore((s) => s.status)
  const latestVersion = useAppUpdateStore((s) => s.latestVersion)
  const userInitiated = useAppUpdateStore((s) => s.userInitiated)
  const phase = useApkInstallStore((s) => s.phase)
  const progress = useApkInstallStore((s) => s.progress)
  const error = useApkInstallStore((s) => s.error)
  const [latestSeenAt, setLatestSeenAt] = useState<number | null>(null)

  const isUpToDate = status === 'up-to-date' && userInitiated
  useEffect(() => {
    if (!isUpToDate) {
      setLatestSeenAt(null)
      return
    }
    setLatestSeenAt(Date.now())
    const timer = setTimeout(() => setLatestSeenAt(null), UP_TO_DATE_AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [isUpToDate])

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
  if (isUpToDate && latestSeenAt !== null) {
    return { kind: 'up-to-date' }
  }
  if (userInitiated && status === 'error') {
    return { kind: 'check-failed' }
  }
  return { kind: 'hidden' }
}

export function AppUpdateCard() {
  const { colors, space, radius } = useTheme()
  const insets = useSafeAreaInsets()
  const state = useCardState()
  const visible = state.kind !== 'hidden'
  const reveal = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)
  const previousKind = useRef(state.kind)

  useEffect(() => {
    if (visible) {
      setMounted(true)
    }
    Animated.timing(reveal, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 150,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false)
      }
    })
  }, [visible, reveal])

  // Why: a height change between states (notes list → progress bar) animates
  // instead of snapping, which is the "morph" the desktop card has.
  if (previousKind.current !== state.kind) {
    previousKind.current = state.kind
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
  }

  if (!mounted) {
    return null
  }

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: space.lg,
        right: space.lg,
        bottom: insets.bottom + space.lg,
        opacity: reveal,
        transform: [
          { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }
        ],
        backgroundColor: colors.bgRaised,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: radius.xl,
        padding: space.lg,
        shadowColor: colors.shadow,
        shadowOpacity: 0.18,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8
      }}
    >
      <CardBody state={state} />
    </Animated.View>
  )
}

function CardBody({ state }: { state: CardState }) {
  const { colors, space } = useTheme()
  const latestVersion = useAppUpdateStore((s) => s.latestVersion)
  const releaseNotes = useAppUpdateStore((s) => s.releaseNotes)
  const releaseUrl = useAppUpdateStore((s) => s.releaseUrl)
  const updateUrl = useAppUpdateStore((s) => s.updateUrl)
  const dismiss = useAppUpdateStore((s) => s.dismiss)
  const clearUserInitiated = () => useAppUpdateStore.setState({ userInitiated: false })
  const startInstall = useApkInstallStore((s) => s.start)
  const reopenInstaller = useApkInstallStore((s) => s.install)
  const resetInstall = useApkInstallStore((s) => s.reset)
  const installVersion = useApkInstallStore((s) => s.version)
  const version = installVersion ?? latestVersion ?? ''

  const closeButton = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 2 })}
    >
      <X size={16} color={colors.textMuted} />
    </Pressable>
  )

  switch (state.kind) {
    case 'checking':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Txt variant="body" style={{ flex: 1 }}>
            Checking for updates…
          </Txt>
        </View>
      )
    case 'up-to-date':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Check size={18} color={colors.success} />
          <Txt variant="body" style={{ flex: 1 }}>
            You're on the latest version.
          </Txt>
          {closeButton('Dismiss', clearUserInitiated)}
        </View>
      )
    case 'check-failed':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <AlertCircle size={18} color={colors.danger} />
          <Txt variant="body" style={{ flex: 1 }}>
            Could not check for updates.
          </Txt>
          {closeButton('Dismiss', clearUserInitiated)}
        </View>
      )
    case 'available': {
      const notes = releaseNotesExcerpt(releaseNotes)
      return (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Download size={18} color={colors.accent} />
            <Txt variant="heading" weight="semibold" style={{ flex: 1 }}>
              Code UI v{version} is ready
            </Txt>
            {closeButton('Dismiss update', () => void dismiss())}
          </View>
          {notes.length > 0 ? (
            <View style={{ gap: 4 }}>
              {notes.map((line) => (
                <Txt key={line} variant="body" tone="secondary">
                  • {line}
                </Txt>
              ))}
            </View>
          ) : null}
          {releaseUrl ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(releaseUrl)}
              style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.5 : 1 })}
            >
              <Txt variant="caption" tone="muted" style={{ textDecorationLine: 'underline' }}>
                Read the full release notes
              </Txt>
            </Pressable>
          ) : null}
          {updateUrl ? (
            <Button
              label="Update"
              variant="accent"
              block
              onPress={() => void startInstall({ url: updateUrl, version })}
            />
          ) : null}
        </View>
      )
    }
    case 'downloading': {
      const percent = Math.round(state.progress * 100)
      return (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Txt variant="heading" weight="semibold" style={{ flex: 1 }}>
              Downloading v{version}…
            </Txt>
            <Txt variant="caption" tone="muted">
              {percent}%
            </Txt>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            style={{ height: 6, borderRadius: 3, backgroundColor: colors.bgSunken, overflow: 'hidden' }}
          >
            <View style={{ width: `${percent}%`, height: '100%', backgroundColor: colors.accent }} />
          </View>
        </View>
      )
    }
    case 'ready':
      return (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Check size={18} color={colors.success} />
            <Txt variant="heading" weight="semibold" style={{ flex: 1 }}>
              v{version} is ready to install
            </Txt>
            {closeButton('Dismiss', resetInstall)}
          </View>
          <Txt variant="body" tone="secondary">
            Android asks you to confirm. Your paired hosts stay saved.
          </Txt>
          <Button label="Install" variant="accent" block onPress={() => void reopenInstaller()} />
        </View>
      )
    case 'failed':
      return (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <AlertCircle size={18} color={colors.danger} />
            <Txt variant="heading" weight="semibold" style={{ flex: 1 }}>
              Update failed
            </Txt>
            {closeButton('Dismiss', resetInstall)}
          </View>
          <Txt variant="body" tone="secondary">
            {state.error}
          </Txt>
          {updateUrl ? (
            <Button
              label="Retry"
              variant="secondary"
              block
              onPress={() => void startInstall({ url: updateUrl, version })}
            />
          ) : null}
        </View>
      )
    default:
      return null
  }
}
