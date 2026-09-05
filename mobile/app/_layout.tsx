import { useCallback, useEffect, useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import * as Notifications from 'expo-notifications'
import * as Linking from 'expo-linking'
import { RpcClientProvider } from '../src/transport/client-context'
import { getNotificationNavigationTarget } from '../src/notifications/notification-routing'
import { useOpenNotificationRoute } from '../src/notifications/use-open-notification-route'
import { loadHostCatalog } from '../src/transport/host-store'
import { extractPairingCodeFromUrl } from '../src/transport/pairing'
import { recoverMobileRelayPairing } from '../src/transport/mobile-relay-pairing-recovery'
import { useAppFonts } from '../src/theme/fonts'
import { ThemeProvider, useTheme } from '../src/theme/theme-context'

// Why: keeps the native splash screen visible until the React tree is mounted
// and ready to render. Without this the user sees a blank white/black frame
// between the native splash and the first React paint.
SplashScreen.preventAutoHideAsync()

// Why: without this, expo-notifications silently drops notifications when
// the app is in the foreground. Setting all three to true makes iOS/Android
// display the banner, play the sound, and show the badge even while the
// app is active. This runs once at module load time before any notification
// is scheduled.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
})

// expo-router picks this export up for every route below the root layout.
export { AppErrorBoundary as ErrorBoundary } from '../src/components/AppErrorBoundary'

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedRoot />
    </ThemeProvider>
  )
}

function ThemedRoot() {
  const router = useRouter()
  const { colors, fonts, isDark } = useTheme()
  const openNotificationRoute = useOpenNotificationRoute()
  const handledNotificationIdsRef = useRef<Set<string>>(new Set())
  // Why: Instrument Sans is the only UI face. Rendering before it loads would
  // flash the system font, so the splash stays up until the faces are ready or
  // loading fails (then the fallback stack renders rather than a hung splash).
  const [fontsLoaded, fontError] = useAppFonts()
  const fontsReady = fontsLoaded || fontError !== null

  useEffect(() => {
    // Why: pairing publication is journaled across process death; startup must
    // reconcile the server result before another scan can replace that journal.
    void recoverMobileRelayPairing()
  }, [])

  // Why: route `orca://pair?...` and `codeui://pair?...` deep links to the
  // confirm screen so the same pairing flow runs whether the link arrived via
  // QR scan, paste, AirDrop, Messages, or `adb shell am start`. getInitialURL
  // covers cold-start (link tapped while app was closed); the listener covers
  // warm-start (link tapped while app is in memory).
  useEffect(() => {
    function handleUrl(url: string) {
      const code = extractPairingCodeFromUrl(url)
      if (code) {
        // Why: Android camera launches can leave Expo Router's unmatched
        // `pair` route underneath this screen; replacing keeps cancel
        // and edge-back from revealing the router error page.
        router.replace({ pathname: '/pair-confirm', params: { code } })
      }
    }

    void Linking.getInitialURL().then((url) => {
      if (url) {
        handleUrl(url)
      }
    })

    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url))
    return () => sub.remove()
  }, [router])

  // ─── Notification tap routing ───
  // Why: iOS delivers local notification taps through expo-notifications,
  // not Linking. Route both cold-start and warm-start responses to the host
  // and worktree that scheduled the notification.
  useEffect(() => {
    let disposed = false

    function clearLastNotificationResponse() {
      try {
        Notifications.clearLastNotificationResponse()
      } catch {
        // Older native shells may not expose the clear API; duplicate guards
        // still protect the current JS runtime.
      }
    }

    function getInitialNotificationResponse(): Notifications.NotificationResponse | null {
      try {
        return Notifications.getLastNotificationResponse()
      } catch {
        return null
      }
    }

    async function getNavigationTarget(data: unknown) {
      const hosts = await loadHostCatalog().catch(() => null)
      return getNotificationNavigationTarget(data, {
        knownHostIds: hosts ? new Set(hosts.map((host) => host.id)) : undefined,
        credentialStatusByHostId: hosts
          ? new Map(hosts.map((host) => [host.id, host.credentialStatus]))
          : undefined
      })
    }

    async function handleNotificationResponse(response: Notifications.NotificationResponse) {
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
        clearLastNotificationResponse()
        return
      }

      const notificationId = response.notification.request.identifier
      if (handledNotificationIdsRef.current.has(notificationId)) {
        return
      }
      handledNotificationIdsRef.current.add(notificationId)
      // Why: RootLayout never unmounts, so cap this tap-dedup set (FIFO) rather
      // than letting it grow one id per notification tapped for the app's life.
      if (handledNotificationIdsRef.current.size > 256) {
        const oldest = handledNotificationIdsRef.current.values().next().value
        if (oldest !== undefined) {
          handledNotificationIdsRef.current.delete(oldest)
        }
      }

      const target = await getNavigationTarget(response.notification.request.content.data)
      clearLastNotificationResponse()
      if (disposed) {
        return
      }
      if (target) {
        openNotificationRoute(target)
      }
    }

    const initialResponse = getInitialNotificationResponse()
    if (initialResponse) {
      void handleNotificationResponse(initialResponse)
    }

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleNotificationResponse(response)
    })
    return () => {
      disposed = true
      sub.remove()
    }
  }, [openNotificationRoute])
  // ─── End notification tap routing ───

  // Why: hide the native splash only once the navigation Stack has been laid
  // out and the fonts are in — this is the earliest moment the user will see
  // actual, correctly typeset app content.
  const layoutReadyRef = useRef(false)
  const hideSplashIfReady = useCallback(() => {
    if (layoutReadyRef.current && fontsReady) {
      void SplashScreen.hideAsync()
    }
  }, [fontsReady])
  useEffect(() => {
    hideSplashIfReady()
  }, [hideSplashIfReady])
  const onNavigatorLayout = useCallback(() => {
    layoutReadyRef.current = true
    hideSplashIfReady()
  }, [hideSplashIfReady])

  if (!fontsReady) {
    return <View style={[styles.root, { backgroundColor: colors.bg }]} />
  }

  return (
    <RpcClientProvider>
      <View style={[styles.root, { backgroundColor: colors.bg }]} onLayout={onNavigatorLayout}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontSize: 17, fontFamily: fonts.semibold },
            contentStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false
            // Why: deliberately no `orientation` screenOption. react-native-screens
            // has no value that respects the device rotation lock — even 'default'
            // calls setRequestedOrientation(UNSPECIFIED) at runtime, overriding the
            // manifest. Leaving it unset lets the manifest's "fullUser" (set by the
            // android-respect-rotation-lock config plugin) honor the auto-rotate lock.
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="pair-scan" options={{ headerShown: false }} />
          <Stack.Screen name="pair" options={{ headerShown: false }} />
          <Stack.Screen name="pair-confirm" options={{ headerShown: false }} />
          <Stack.Screen
            name="mobile-onboarding"
            options={{ headerShown: false, presentation: 'modal', gestureEnabled: false }}
          />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
          <Stack.Screen name="appearance-settings" options={{ headerShown: false }} />
          <Stack.Screen name="terminal-settings" options={{ headerShown: false }} />
          <Stack.Screen name="native-chat-settings" options={{ headerShown: false }} />
          <Stack.Screen name="browser-settings" options={{ headerShown: false }} />
          <Stack.Screen name="voice-settings" options={{ headerShown: false }} />
          <Stack.Screen name="notifications" options={{ headerShown: false }} />
          <Stack.Screen name="troubleshoot" options={{ headerShown: false }} />
          <Stack.Screen name="connection-log" options={{ headerShown: false }} />
          <Stack.Screen name="about" options={{ headerShown: false }} />
          <Stack.Screen name="h" options={{ headerShown: false }} />
        </Stack>
      </View>
    </RpcClientProvider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  }
})
