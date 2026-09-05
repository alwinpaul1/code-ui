import { useCallback, useRef, useState } from 'react'
import { View, Linking, ActivityIndicator, ScrollView, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import {
  ChevronRight,
  Info,
  Bell,
  Wrench,
  Shield,
  LifeBuoy,
  Mic,
  Globe,
  MessageSquare,
  Palette,
  Terminal as TerminalIcon,
  KeyRound,
  type LucideIcon
} from 'lucide-react-native'
import { useTheme } from '../src/theme/theme-context'
import { Button } from '../src/ui/Button'
import { ScreenHeader } from '../src/ui/ScreenHeader'
import { SectionLabel } from '../src/ui/SectionLabel'
import { Surface } from '../src/ui/Surface'
import { Txt } from '../src/ui/Txt'
import {
  loadPendingHostCredentialCleanup,
  subscribePendingHostCredentialCleanup
} from '../src/transport/host-credential-cleanup'
import { retryPendingHostCredentialCleanup } from '../src/transport/host-store'

function SettingsRow({
  icon: Icon,
  label,
  value,
  onPress,
  first = false
}: {
  icon: LucideIcon
  label: string
  value?: string
  onPress: () => void
  first?: boolean
}) {
  const { colors, space } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 54,
        paddingHorizontal: space.lg,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.bgRaised : 'transparent'
      })}
      onPress={onPress}
    >
      <Icon size={18} color={colors.textSecondary} strokeWidth={2} />
      <Txt variant="body" weight="medium" style={{ flex: 1 }}>
        {label}
      </Txt>
      {value ? (
        <Txt variant="label" tone="muted">
          {value}
        </Txt>
      ) : null}
      <ChevronRight size={16} color={colors.textMuted} />
    </Pressable>
  )
}

export default function SettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors, preference, space } = useTheme()
  const [pendingCredentialIds, setPendingCredentialIds] = useState<string[]>([])
  const [credentialStorageUnreadable, setCredentialStorageUnreadable] = useState(false)
  const [retryingCredentialCleanup, setRetryingCredentialCleanup] = useState(false)
  const [credentialRetryFailed, setCredentialRetryFailed] = useState(false)
  const credentialRefreshGenerationRef = useRef(0)

  useFocusEffect(
    useCallback(() => {
      let active = true
      setCredentialRetryFailed(false)
      const refresh = () => {
        const generation = ++credentialRefreshGenerationRef.current
        void loadPendingHostCredentialCleanup().then((state) => {
          if (active && generation === credentialRefreshGenerationRef.current) {
            setPendingCredentialIds(state.ids)
            setCredentialStorageUnreadable(state.storageUnreadable)
            // Why: neutral copy once the queue is confirmed empty so a later
            // pending set does not inherit a previous Retry failure message.
            if (state.ids.length === 0 && !state.storageUnreadable) {
              setCredentialRetryFailed(false)
            }
          }
        })
      }
      const unsubscribe = subscribePendingHostCredentialCleanup(refresh)
      refresh()
      return () => {
        active = false
        credentialRefreshGenerationRef.current += 1
        unsubscribe()
      }
    }, [])
  )

  const retryCredentialCleanup = useCallback(async () => {
    if (retryingCredentialCleanup) {
      return
    }
    setCredentialRetryFailed(false)
    setRetryingCredentialCleanup(true)
    try {
      const result = await retryPendingHostCredentialCleanup()
      setPendingCredentialIds(result.remainingIds)
      setCredentialStorageUnreadable(result.storageUnreadable)
      setCredentialRetryFailed(result.remainingIds.length > 0 || result.storageUnreadable)
    } catch {
      setCredentialRetryFailed(true)
    } finally {
      setRetryingCredentialCleanup(false)
    }
  }, [retryingCredentialCleanup])

  const pendingCredentialCount = pendingCredentialIds.length
  // Why: show the cleanup card whenever cleanup is pending OR the durable queue
  // is unreadable — an unreadable queue can hide an orphaned token, so keep a
  // retry affordance rather than a silently-empty (hidden) section.
  const showCredentialCleanup = pendingCredentialCount > 0 || credentialStorageUnreadable
  const appearanceValue =
    preference === 'system' ? 'System' : preference === 'dark' ? 'Dark' : 'Light'

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Settings" onBack={() => router.back()} large />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + space.xl
        }}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel style={{ marginTop: space.sm }}>App</SectionLabel>
        <Surface rounded="lg" style={{ overflow: 'hidden' }}>
          <SettingsRow
            icon={Palette}
            label="Appearance"
            value={appearanceValue}
            onPress={() => router.push('/appearance-settings')}
            first
          />
          <SettingsRow
            icon={MessageSquare}
            label="Chat UI"
            onPress={() => router.push('/native-chat-settings')}
          />
          <SettingsRow
            icon={TerminalIcon}
            label="Terminal"
            onPress={() => router.push('/terminal-settings')}
          />
          <SettingsRow
            icon={Globe}
            label="Browser"
            onPress={() => router.push('/browser-settings')}
          />
          <SettingsRow icon={Mic} label="Voice" onPress={() => router.push('/voice-settings')} />
          <SettingsRow
            icon={Bell}
            label="Notifications"
            onPress={() => router.push('/notifications')}
          />
        </Surface>

        <SectionLabel>Support</SectionLabel>
        <Surface rounded="lg" style={{ overflow: 'hidden' }}>
          <SettingsRow
            icon={Wrench}
            label="Troubleshooting"
            onPress={() => router.push('/troubleshoot')}
            first
          />
          <SettingsRow icon={Info} label="About" onPress={() => router.push('/about')} />
          <SettingsRow
            icon={Shield}
            label="Privacy policy"
            onPress={() => void Linking.openURL('https://www.onorca.dev/privacy')}
          />
          <SettingsRow
            icon={LifeBuoy}
            label="Report an issue"
            onPress={() => void Linking.openURL('https://github.com/stablyai/orca/issues')}
          />
        </Surface>

        {showCredentialCleanup ? (
          <>
            <SectionLabel>Pairing</SectionLabel>
            <Surface
              rounded="lg"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingVertical: space.md,
                paddingHorizontal: space.lg
              }}
            >
              <KeyRound size={18} color={colors.warning} />
              <View style={{ flex: 1, gap: space.xs }}>
                <Txt variant="body" weight="medium">
                  Pairing credential cleanup
                </Txt>
                <Txt accessibilityLiveRegion="polite" variant="caption" tone="secondary">
                  {credentialRetryFailed
                    ? "Cleanup still couldn't be confirmed. Try again later."
                    : pendingCredentialCount > 0
                      ? `Couldn't confirm cleanup for ${pendingCredentialCount} credential${pendingCredentialCount === 1 ? '' : 's'} on this device.`
                      : "Couldn't check cleanup status on this device. Retry to be safe."}
                </Txt>
              </View>
              {retryingCredentialCleanup ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Button
                  label="Retry"
                  size="sm"
                  variant="secondary"
                  accessibilityLabel="Retry clearing pairing credentials"
                  onPress={() => void retryCredentialCleanup()}
                />
              )}
            </Surface>
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}
