import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { MessageSquare } from 'lucide-react-native'
import type { MobileOnboardingStep } from './mobile-onboarding-plan'
import { mobileOnboardingStyles as styles } from './mobile-onboarding-styles'
import { NotificationOnboardingPreview } from './NotificationOnboardingPreview'
import type { MobileSessionView } from '../storage/session-view-preferences'
import { useTheme } from '../theme/theme-context'

export type NotificationOnboardingChoice = 'enable' | 'skip'
export type MobileOnboardingBusyChoice = MobileSessionView | NotificationOnboardingChoice | null

type Props = {
  step: MobileOnboardingStep
  width: number
  active: boolean
  busyChoice: MobileOnboardingBusyChoice
  error: string | null
  onSessionChoice: (view: MobileSessionView) => void
  onNotificationChoice: (choice: NotificationOnboardingChoice) => void
}

export function MobileOnboardingPage({
  step,
  width,
  active,
  busyChoice,
  error,
  onSessionChoice,
  onNotificationChoice
}: Props) {
  // The shell paints its background from this palette; drawing the page from
  // the legacy static one left near-white text on the light background.
  const { colors } = useTheme()
  const busy = busyChoice !== null
  const isSessionView = step === 'session-view'

  return (
    <ScrollView
      style={[styles.page, { width }]}
      contentContainerStyle={styles.pageContent}
      showsVerticalScrollIndicator={false}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    >
      <View style={[styles.content, !isSessionView && styles.notificationContent]}>
        {isSessionView ? (
          <View style={[styles.iconSurface, { backgroundColor: colors.bgRaised }]}>
            <MessageSquare size={30} color={colors.text} />
          </View>
        ) : (
          <NotificationOnboardingPreview active={active} />
        )}
        <Text style={[styles.title, { color: colors.text }]}>
          {isSessionView ? 'How should sessions open?' : 'Don’t miss when an agent needs you'}
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          {isSessionView
            ? 'Choose whether supported agent sessions open in the terminal or Chat UI on this device. Press and hold a session tab to switch its view, or change the default later in Settings.'
            : 'Get a notification on this phone when an agent finishes or is waiting — even if you aren’t using the app.'}
        </Text>
      </View>

      <View style={styles.footer}>
        {/* Why not upstream's wording: upstream delivers through Orca's push
            service after a 3-minute desktop idle. This fork has no push service
            — notifications are local ones raised over the desktop connection,
            which a background service holds open while the app is closed. Saying
            otherwise would misdescribe the one mechanism this screen exists to
            explain. */}
        {!isSessionView ? (
          <Text style={[styles.disclosure, { color: colors.textMuted }]}>
            Delivered over your desktop connection, which a background service keeps open while
            the app is closed. Change this anytime in Settings.
          </Text>
        ) : null}
        {error ? (
          <Text style={[styles.error, { color: colors.danger }]} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {isSessionView ? (
          <SessionViewChoices busyChoice={busyChoice} disabled={busy} onChoice={onSessionChoice} />
        ) : (
          <NotificationChoices
            busyChoice={busyChoice}
            disabled={busy}
            onChoice={onNotificationChoice}
          />
        )}
      </View>
    </ScrollView>
  )
}

function SessionViewChoices({
  busyChoice,
  disabled,
  onChoice
}: {
  busyChoice: MobileOnboardingBusyChoice
  disabled: boolean
  onChoice: (view: MobileSessionView) => void
}) {
  return (
    <>
      <ChoiceButton
        label="Use Chat UI"
        accessibilityLabel="Open sessions in Chat UI"
        primary
        busy={busyChoice === 'chat'}
        disabled={disabled}
        onPress={() => onChoice('chat')}
      />
      <ChoiceButton
        label="Keep terminal"
        accessibilityLabel="Open sessions in the terminal"
        busy={busyChoice === 'terminal'}
        disabled={disabled}
        onPress={() => onChoice('terminal')}
      />
    </>
  )
}

function NotificationChoices({
  busyChoice,
  disabled,
  onChoice
}: {
  busyChoice: MobileOnboardingBusyChoice
  disabled: boolean
  onChoice: (choice: NotificationOnboardingChoice) => void
}) {
  return (
    <>
      <ChoiceButton
        label="Enable notifications"
        accessibilityLabel="Enable agent notifications"
        primary
        busy={busyChoice === 'enable'}
        disabled={disabled}
        onPress={() => onChoice('enable')}
      />
      <ChoiceButton
        label="Not now"
        accessibilityLabel="Skip notifications for now"
        busy={busyChoice === 'skip'}
        disabled={disabled}
        onPress={() => onChoice('skip')}
      />
    </>
  )
}

function ChoiceButton({
  label,
  accessibilityLabel,
  primary = false,
  busy,
  disabled,
  onPress
}: {
  label: string
  accessibilityLabel?: string
  primary?: boolean
  busy: boolean
  disabled: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      style={({ pressed }) => [
        primary
          ? [styles.primaryButton, { backgroundColor: colors.accent }]
          : styles.secondaryButton,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled
      ]}
      onPress={onPress}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.onAccent : colors.textSecondary} />
      ) : (
        <Text
          style={
            primary
              ? [styles.primaryButtonText, { color: colors.onAccent }]
              : [styles.secondaryButtonText, { color: colors.textSecondary }]
          }
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}
