import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { OrcaLogo } from '../components/OrcaLogo'
import { radii, spacing, typography } from '../theme/mobile-theme'
import { useTheme } from '../theme/theme-context'
import { useReducedMotion } from '../ui/use-reduced-motion'

const SAMPLE_NOTIFICATIONS = [
  { title: 'Codex finished', body: 'Tests are passing.' },
  { title: 'Claude needs input', body: 'Waiting on you.' }
] as const

const ENTER_MS = 676
const EXIT_MS = 416
const STAGGER_MS = 546
const HOLD_MS = 2860
const GAP_MS = 624
const SLIDE_FROM_Y = -22

type Props = {
  active: boolean
}

/** Decorative banners; the surrounding copy is the accessible explanation. */
export function NotificationOnboardingPreview({ active }: Props) {
  const reduceMotion = useReducedMotion()
  const first = useRef(new Animated.Value(0)).current
  const second = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!active || reduceMotion === null) {
      first.setValue(0)
      second.setValue(0)
      return
    }
    if (reduceMotion) {
      first.setValue(1)
      second.setValue(1)
      return
    }

    const enter = (value: Animated.Value) =>
      Animated.timing(value, {
        toValue: 1,
        duration: ENTER_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      })
    const leave = (value: Animated.Value) =>
      Animated.timing(value, {
        toValue: 0,
        duration: EXIT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true
      })
    const loop = Animated.loop(
      Animated.sequence([
        enter(first),
        Animated.delay(STAGGER_MS),
        enter(second),
        Animated.delay(HOLD_MS),
        Animated.parallel([leave(first), leave(second)]),
        Animated.delay(GAP_MS)
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [active, first, reduceMotion, second])

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      testID="notification-onboarding-preview"
      style={styles.stack}
    >
      <Animated.View style={bannerMotion(first)}>
        <SampleBanner notification={SAMPLE_NOTIFICATIONS[0]} />
      </Animated.View>
      <Animated.View style={bannerMotion(second)}>
        <SampleBanner notification={SAMPLE_NOTIFICATIONS[1]} />
      </Animated.View>
    </View>
  )
}

function SampleBanner({ notification }: { notification: (typeof SAMPLE_NOTIFICATIONS)[number] }) {
  // Drawn from the appearance setting, like the shell around it: the static
  // sheet's values are dark-only and would sit near-white on a light banner.
  const { colors } = useTheme()
  return (
    <View
      style={[styles.card, { backgroundColor: colors.bgPanel, borderColor: colors.border }]}
    >
      <View style={[styles.appIcon, { backgroundColor: colors.bgRaised }]}>
        <OrcaLogo size={14} />
      </View>
      <View style={styles.cardCopy}>
        <View style={styles.cardMeta}>
          {/* The fork ships as Code UI; a preview of this phone's own
              notification must name the app the user actually installed. */}
          <Text style={[styles.appName, { color: colors.textMuted }]}>Code UI</Text>
          <Text style={[styles.now, { color: colors.textMuted }]}>now</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
          {notification.title}
        </Text>
        <Text style={[styles.cardBody, { color: colors.textSecondary }]} numberOfLines={1}>
          {notification.body}
        </Text>
      </View>
    </View>
  )
}

function bannerMotion(progress: Animated.Value) {
  return {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [SLIDE_FROM_Y, 0]
        })
      }
    ]
  }
}

const styles = StyleSheet.create({
  stack: {
    width: '100%',
    maxWidth: 320,
    gap: spacing.sm,
    marginBottom: spacing.xl + spacing.lg
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md
  },
  appIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.camera,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cardCopy: {
    flex: 1,
    minWidth: 0
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2
  },
  appName: {
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  now: {
    fontSize: typography.metaSize
  },
  cardTitle: {
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  cardBody: {
    fontSize: typography.metaSize,
    marginTop: 1
  }
})
