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
  applyBackgroundDelivery,
  isBackgroundDeliveryAvailable,
  isBackgroundDeliveryUnrestricted,
  requestBackgroundDeliveryUnrestricted
} from '../src/background/background-link'
import { adviseBackgroundDeliveryPower } from '../src/background/background-delivery-power'

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
  const [permissionState, setPermissionState] = useState(DEFAULT_PERMISSION_STATE)
  const [unrestricted, setUnrestricted] = useState(true)
  const backgroundAvailable = isBackgroundDeliveryAvailable()

  const refreshSettings = useCallback(async () => {
    const [enabled, permission] = await Promise.all([
      loadPushNotificationsEnabled(),
      getNotificationPermissionState()
    ])
    setPushEnabled(enabled)
    setPermissionState(permission)
    setUnrestricted(isBackgroundDeliveryUnrestricted())
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
    // Background delivery rides on agent notifications and is always on with
    // them: off means off for both, on means the link runs while the app is
    // closed.
    const on = value && backgroundAvailable
    applyBackgroundDelivery(on)
    // Why: without the battery exemption Doze silences the link while the phone
    // idles, and the notifications only show up when the app is opened. Ask the
    // moment notifications are switched on, while we are still in the foreground.
    if (on && adviseBackgroundDeliveryPower({ deliveryOn: true, unrestricted }).promptOnEnable) {
      requestBackgroundDeliveryUnrestricted()
    }
  }

  const switchEnabled = pushEnabled && permissionState.granted
  const power = adviseBackgroundDeliveryPower({
    deliveryOn: backgroundAvailable && switchEnabled,
    unrestricted
  })
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
          {power.showRow ? (
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
                  Allow unrestricted battery use
                </Txt>
                <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  {power.caption}
                </Txt>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Allow unrestricted battery use"
                onPress={() => {
                  requestBackgroundDeliveryUnrestricted()
                }}
                style={({ pressed }) => ({
                  paddingVertical: space.sm,
                  paddingHorizontal: space.md,
                  borderRadius: 10,
                  backgroundColor: pressed ? colors.bgRaised : colors.accent
                })}
              >
                <Txt variant="body" weight="medium" style={{ color: colors.onAccent }}>
                  Allow
                </Txt>
              </Pressable>
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
