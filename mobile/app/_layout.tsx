import { useCallback, useEffect, useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import * as Notifications from 'expo-notifications'
import * as Linking from 'expo-linking'
import { RpcClientProvider } from '../src/transport/client-context'
import {
  getNotificationNavigationTarget,
  notificationTapKey
} from '../src/notifications/notification-routing'
import { isAppUpdateNotification } from '../src/app-update/update-notification'
import {
  useOpenAppUpdateNotification,
  useOpenNotificationRoute
} from '../src/notifications/use-open-notification-route'
import { loadHostCatalog } from '../src/transport/host-store'
import { extractPairingCodeFromUrl } from '../src/transport/pairing'
import { recoverMobileRelayPairing } from '../src/transport/mobile-relay-pairing-recovery'
import { useAppFonts } from '../src/theme/fonts'
import { ThemeProvider, useTheme } from '../src/theme/theme-context'
import { hydrateSessionCaches } from '../src/session/session-caches-hydrate'
import { askBackgroundDeliveryPowerOnOpen, getBackgroundLinkWatcher } from '../src/background/background-link'
import { startBackgroundLinkHealing } from '../src/background/background-link-healing'
import { answerPromptFromNotification } from '../src/notifications/prompt-notification-response'
import { lookupPendingPrompt } from '../src/notifications/permission-lookup'
import { sendQuestionAnswerFromNotification } from '../src/notifications/question-notification-send'
import { repostBannerWithReplyVerdict } from '../src/notifications/question-reply-verdict'
import { peekLiveHostClient } from '../src/transport/live-host-clients'
import { sendMobileNativeChatPermissionResponse } from '../src/session/mobile-native-chat-permission-send'
import { ImagePreviewModal } from '../src/components/ImagePreviewModal'
import { MobileImageMarkupEditor } from '../src/components/MobileImageMarkupEditor'
import { MobileBackgroundPowerPrompt } from '../src/components/MobileBackgroundPowerPrompt'

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
  const openAppUpdateNotification = useOpenAppUpdateNotification()
  const handledNotificationIdsRef = useRef<Set<string>>(new Set())
  // Why: Instrument Sans is the only UI face. Rendering before it loads would
  // flash the system font, so the splash stays up until the faces are ready or
  // loading fails (then the fallback stack renders rather than a hung splash).
  const [fontsLoaded, fontError] = useAppFonts()
  const fontsReady = fontsLoaded || fontError !== null

  useEffect(() => {
    // Why here: a foreground service may only be started from the foreground,
    // and launch is the one moment that is certain. The same call asks once for
    // the battery exemption when delivery is already on without it — someone who
    // had notifications on before an update never flips the switch that used to
    // be the only thing that asked (2026-09-15).
    void askBackgroundDeliveryPowerOnOpen()
  }, [])

  useEffect(() => {
    // Why the app has to do this at all: nothing else restarts the link once
    // Android has killed the service. The Settings toggle was its only caller,
    // so the recovery nobody could guess was toggle off, toggle on. Running it
    // here and on every return to the foreground is the moment a
    // foreground-service start is actually permitted.
    return startBackgroundLinkHealing()
  }, [])

  useEffect(() => {
    // Why: pairing publication is journaled across process death; startup must
    // reconcile the server result before another scan can replace that journal.
    void recoverMobileRelayPairing()
    // Why: project caches (last tabs, last transcript) live on disk too, so a
    // cold start paints a project from the last visit instead of two spinners.
    void hydrateSessionCaches()
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
        // An Approve/Deny button on a permission banner, a choice on a
        // question banner, or a reply typed into one. It answers WITHOUT
        // opening the app, which is the point: the alternative was unlock,
        // open, find the session, tap. Anything that is not one of ours falls
        // through to the clear below, exactly as before.
        const userText = response.userText ?? null
        const outcome = await answerPromptFromNotification({
          actionIdentifier: response.actionIdentifier,
          // What a reply field returned; undefined for a plain button.
          userText,
          data: response.notification.request.content.data,
          // The UI's client first; failing that, the link the background
          // watcher is listening on — which is the one the banner's event came
          // over when the app was in the background, and the only one there is.
          resolveClient: (id) =>
            peekLiveHostClient(id) ?? getBackgroundLinkWatcher().peekClient(id),
          lookup: lookupPendingPrompt,
          sendPermission: async ({ client, terminal, text }) =>
            (await sendMobileNativeChatPermissionResponse({
              client,
              terminal,
              // Null on this path: it only tags the send with a mobile-client
              // id for attribution, and the shade has no session to read it
              // from. The keystrokes are identical either way.
              deviceToken: null,
              text
              // Only 'accepted' counts. 'unknown' means the ack was lost and the
              // answer may still have landed — but a retry is safe, because the
              // re-check finds no matching prompt once one has.
            })) === 'accepted',
          // Same road as the chat card's answer: option numbers and typed
          // text as keystrokes, built by the shared key builders and paced by
          // the shared stepper, under the terminal write lock.
          sendQuestion: sendQuestionAnswerFromNotification
        })
        // A typed reply leaves Android showing the text with a spinner until
        // the notification is updated. Sent: the desktop's dismiss clears it
        // when the agent moves on. Not sent: nothing would, and the user would
        // never learn why — so the banner is posted again with the reason on top.
        if (userText !== null && outcome !== 'sent' && outcome !== 'not-an-answer') {
          await repostBannerWithReplyVerdict(response, outcome)
        }
        clearLastNotificationResponse()
        return
      }

      // Keyed per POSTING, not per banner: a session's banners all share one
      // request identifier, and keying on that alone let one body tap per
      // session per app life through (2026-09-18).
      const notificationId = notificationTapKey(response)
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

      const data = response.notification.request.content.data
      // Why: an update notification has no host to route to. Home already
      // mounts the update dialog, which shows the release on arrival.
      if (isAppUpdateNotification(data)) {
        clearLastNotificationResponse()
        if (!disposed) {
          openAppUpdateNotification()
        }
        return
      }
      const target = await getNavigationTarget(data)
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
  }, [openAppUpdateNotification, openNotificationRoute])
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
        {/* Mounted once, above every route: the battery prompt is raised from a
            launch effect outside the tree and needs somewhere to render. */}
        <MobileBackgroundPowerPrompt />
        {/* Likewise the full-screen image viewer: a chat thumbnail, a
            markdown figure and an image file all open it (2026-09-19). */}
        <ImagePreviewModal />
        {/* And the markup editor: the composer's attachment pencil and the
            preview's own pencil both open it (2026-09-24). */}
        <MobileImageMarkupEditor />
      </View>
    </RpcClientProvider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  }
})
