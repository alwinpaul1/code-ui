import { AppState, Platform } from 'react-native'
import {
  isBackgroundLinkSupported,
  isBackgroundLinkUnrestricted,
  requestBackgroundLinkUnrestricted,
  startBackgroundLink,
  stopBackgroundLink
} from '@codeui/expo-background-link'
import { subscribeToDesktopNotifications } from '../notifications/mobile-notifications'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { subscribeConnectionRevivalTriggers } from '../transport/connection-revival-triggers'
import { openHostLogicalClient } from '../transport/host-logical-client'
import { loadHosts } from '../transport/host-store'
import { connectionLogStore } from '../transport/persisted-connection-log-store'
import type { RpcClient } from '../transport/rpc-client'
import type { HostProfile } from '../transport/types'
import { loadBackgroundDeliveryEnabled } from './background-link-preference'
import {
  createBackgroundNotificationWatcher,
  type BackgroundNotificationWatcher
} from './background-notification-watcher'

const SERVICE_TITLE = 'Code UI'
const SERVICE_TEXT = 'Listening for agent notifications'

let watcher: BackgroundNotificationWatcher | null = null

function log(message: string, detail = ''): void {
  console.log(`[background-link] ${message}`, detail)
}

function openBackgroundClient(host: HostProfile): RpcClient {
  const client = openHostLogicalClient(
    host,
    (entry) => connectionLogStore.append(host.id, entry),
    { backgroundLink: true }
  )
  // Why: the UI's provider is what normally forwards "network came back"
  // nudges; with no UI mounted the listener has to subscribe for itself.
  const unsubscribeRevival = subscribeConnectionRevivalTriggers((reason) =>
    client.notifyForeground(reason)
  )
  const close = client.close
  client.close = () => {
    unsubscribeRevival()
    close()
  }
  return client
}

/** The one watcher for the process, created on first use. */
export function getBackgroundLinkWatcher(): BackgroundNotificationWatcher {
  if (watcher) {
    return watcher
  }
  watcher = createBackgroundNotificationWatcher({
    loadHosts,
    openClient: openBackgroundClient,
    subscribeNotifications: subscribeToDesktopNotifications,
    log
  })
  watcher.setUiVisible(AppState.currentState === 'active')
  AppState.addEventListener('change', (state) => {
    watcher?.setUiVisible(state === 'active')
  })
  return watcher
}

export function isBackgroundDeliveryAvailable(): boolean {
  return Platform.OS === 'android' && isBackgroundLinkSupported
}

/**
 * Whether Android will leave the link's network alone while the phone idles.
 *
 * Why it matters: Doze suspends network and ignores wake locks for every app
 * that is still under battery optimisation, foreground service or not. The
 * socket then goes silent until a maintenance window or the next screen-on,
 * which is exactly "notifications arrive when I open the app".
 */
export function isBackgroundDeliveryUnrestricted(): boolean {
  return !isBackgroundDeliveryAvailable() || isBackgroundLinkUnrestricted()
}

/** Opens the system prompt for the exemption. Must run from the foreground. */
export function requestBackgroundDeliveryUnrestricted(): boolean {
  return requestBackgroundLinkUnrestricted()
}

/**
 * Apply the user's choice: run (or stop) the foreground service and the
 * watcher behind it. Must be called from the foreground — Android refuses to
 * start a foreground service from the background — which is why the app
 * calls it on launch and on the toggle, never from a background transition.
 */
export function applyBackgroundDelivery(enabled: boolean): void {
  const on = enabled && isBackgroundDeliveryAvailable()
  getBackgroundLinkWatcher().setEnabled(on)
  if (on) {
    startBackgroundLink(SERVICE_TITLE, SERVICE_TEXT)
  } else {
    stopBackgroundLink()
  }
}

/** Re-derive the running state from stored preferences (launch, headless start). */
export async function syncBackgroundLinkFromPreferences(): Promise<boolean> {
  const [delivery, push] = await Promise.all([
    loadBackgroundDeliveryEnabled(),
    loadPushNotificationsEnabled()
  ])
  const on = delivery && push
  applyBackgroundDelivery(on)
  return on
}
