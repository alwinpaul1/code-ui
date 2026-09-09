import { useState, useCallback, useEffect } from 'react'
import { AppState, Linking, Pressable, ScrollView, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { useTheme } from '../src/theme/theme-context'
import { ScreenHeader } from '../src/ui/ScreenHeader'
import { SectionLabel } from '../src/ui/SectionLabel'
import { Surface } from '../src/ui/Surface'
import { Txt } from '../src/ui/Txt'
import {
  loadPushNotificationsEnabled,
  savePushNotificationsEnabled
} from '../src/storage/preferences'
import {
  ensureNotificationPermissions,
  getNotificationPermissionState,
  type NotificationPermissionState
} from '../src/notifications/mobile-notifications'
import {
  loadBackgroundDeliveryEnabled,
  saveBackgroundDeliveryEnabled
} from '../src/background/background-link-preference'
import {
  applyBackgroundDelivery,
  isBackgroundDeliveryAvailable
} from '../src/background/background-link'

const DEFAULT_PERMISSION_STATE: NotificationPermissionState = {
  granted: false,
  status: 'undetermined',
  canAskAgain: true,
  authorizationReflectsUserChoice: false
}

export default function NotificationsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors, space } = useTheme()
  const [pushEnabled, setPushEnabled] = useState(false)
  const [backgroundEnabled, setBackgroundEnabled] = useState(false)
  const [permissionState, setPermissionState] = useState(DEFAULT_PERMISSION_STATE)
  const backgroundAvailable = isBackgroundDeliveryAvailable()

  const refreshSettings = useCallback(async () => {
    const [enabled, background, permission] = await Promise.all([
      loadPushNotificationsEnabled(),
      loadBackgroundDeliveryEnabled(),
      getNotificationPermissionState()
    ])
    setPushEnabled(enabled)
    setBackgroundEnabled(background)
    setPermissionState(permission)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refreshSettings()
    }, [refreshSettings])
  )

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshSettings()
      }
    })
    return () => subscription.remove()
  }, [refreshSettings])

  const togglePush = async (value: boolean) => {
    if (value) {
      const granted = await ensureNotificationPermissions()
      const permission = await getNotificationPermissionState()
      setPermissionState(permission)
      if (!granted) {
        setPushEnabled(false)
        await savePushNotificationsEnabled(false)
        return
      }
    }
    setPushEnabled(value)
    await savePushNotificationsEnabled(value)
    // Background delivery rides on agent notifications; off means off for both.
    applyBackgroundDelivery(value && backgroundEnabled)
  }

  const toggleBackground = async (value: boolean) => {
    setBackgroundEnabled(value)
    await saveBackgroundDeliveryEnabled(value)
    applyBackgroundDelivery(value && pushEnabled && permissionState.granted)
  }

  const switchEnabled = pushEnabled && permissionState.granted
  const notificationsBlocked = permissionState.status === 'denied'
  const hint = notificationsBlocked
    ? 'Notifications are disabled in system settings.'
    : 'Get notified on this device when an agent needs your input or finishes a task.'

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Notifications" onBack={() => router.back()} large />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + space.xl
        }}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel style={{ marginTop: space.sm }}>From your desktop</SectionLabel>
        <Surface rounded="lg" style={{ overflow: 'hidden' }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingVertical: space.md,
              paddingHorizontal: space.lg
            }}
          >
            <View style={{ flex: 1 }}>
              <Txt variant="body" weight="medium">
                Agent notifications
              </Txt>
              <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                {hint}
              </Txt>
            </View>
            <Switch
              accessibilityLabel="Agent notifications"
              value={switchEnabled}
              disabled={notificationsBlocked}
              onValueChange={(v) => void togglePush(v)}
              trackColor={{ false: colors.borderStrong, true: colors.accent }}
              thumbColor={colors.bgPanel}
            />
          </View>
          {backgroundAvailable ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingVertical: space.md,
                paddingHorizontal: space.lg,
                borderTopWidth: 1,
                borderTopColor: colors.border
              }}
            >
              <View style={{ flex: 1 }}>
                <Txt variant="body" weight="medium">
                  Deliver while the app is closed
                </Txt>
                <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  {switchEnabled
                    ? 'Keeps a link to your desktop open in the background.'
                    : 'Turn on agent notifications first.'}
                </Txt>
              </View>
              <Switch
                accessibilityLabel="Deliver while the app is closed"
                value={backgroundEnabled && switchEnabled}
                disabled={!switchEnabled}
                onValueChange={(v) => void toggleBackground(v)}
                trackColor={{ false: colors.borderStrong, true: colors.accent }}
                thumbColor={colors.bgPanel}
              />
            </View>
          ) : null}
        </Surface>
        {notificationsBlocked ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void Linking.openSettings()}
            style={({ pressed }) => ({
              marginTop: space.md,
              alignSelf: 'flex-start',
              paddingVertical: space.sm,
              paddingHorizontal: space.lg,
              borderRadius: 10,
              backgroundColor: pressed ? colors.bgRaised : colors.bgPanel,
              borderWidth: 1,
              borderColor: colors.border
            })}
          >
            <Txt variant="body" weight="medium">
              Open Settings
            </Txt>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  )
}
