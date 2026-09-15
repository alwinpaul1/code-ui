import { peekLiveHostClient } from '../transport/live-host-clients'
import { Alert, AppState, Platform } from 'react-native'
import {
  isBackgroundLinkSupported,
  isBackgroundLinkUnrestricted,
  requestBackgroundLinkUnrestricted,
  startBackgroundLink,
  stopBackgroundLink
} from '@codeui/expo-background-link'
import { subscribeToDesktopNotifications } from '../notifications/mobile-notifications'
import {
  loadBackgroundPowerAskedVersion,
  loadBackgroundPowerLastSeen,
  loadPushNotificationsEnabled,
  saveBackgroundPowerAskedVersion,
  saveBackgroundPowerLastSeen
} from '../storage/preferences'
import { getInstalledVersion } from '../app-update/installed-version'
import {
  BACKGROUND_POWER_PROMPT,
  adviseBackgroundDeliveryPower
} from './background-delivery-power'
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
import { releaseBackgroundLinkTask } from './background-link-task-hold'

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
    peekLiveClient: peekLiveHostClient,
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
    // Why first: the parked headless task is what holds Android's wake lock.
    // Ending it lets the service stop itself and the lock go; stopping the
    // service without it would leave the task parked in a dead service.
    releaseBackgroundLinkTask()
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

/**
 * Ask for the battery exemption, once, when the app opens with delivery already
 * on and no exemption granted.
 *
 * Without this the exemption was only ever requested as part of switching
 * delivery ON, so anyone who already had notifications on and merely UPDATED the
 * app was never asked — and the settings row is only seen by someone who goes
 * looking. They kept getting notifications late with nothing saying why
 * (2026-09-15). Doze suspends the app's network however long the foreground
 * service runs; only the exemption lifts it.
 *
 * Asked once per app VERSION, and only from the foreground: Android refuses the
 * dialog from the background, and one that reappears every launch is one people
 * learn to dismiss without reading. Per version rather than once ever, because
 * AsyncStorage survives an update — a plain flag would mean someone who declined
 * once went on getting late notifications forever, with only a settings row to
 * explain it. An update is a natural moment to ask again. The row remains either
 * way.
 */
export async function askBackgroundDeliveryPowerOnOpen(): Promise<void> {
  if (!isBackgroundDeliveryAvailable()) {
    return
  }
  const version = getInstalledVersion()
  const [deliveryOn, askedVersion, wasUnrestricted] = await Promise.all([
    syncBackgroundLinkFromPreferences(),
    loadBackgroundPowerAskedVersion(),
    loadBackgroundPowerLastSeen()
  ])
  const unrestricted = isBackgroundDeliveryUnrestricted()
  // Recorded every open, so the next one can tell a grant that was taken away
  // from one that was never given.
  await saveBackgroundPowerLastSeen(unrestricted)
  const advice = adviseBackgroundDeliveryPower({
    deliveryOn,
    unrestricted,
    askedThisVersion: askedVersion === version,
    wasUnrestricted
  })
  if (!advice.promptOnOpen) {
    return
  }
  // Marked asked BEFORE showing it: a dismissal must not bring it back on the
  // next launch.
  await saveBackgroundPowerAskedVersion(version)
  // Explained first. Android's own dialog names the cost and not the benefit, so
  // on its own it is declined reflexively — and then notifications are late and
  // nothing connects the two.
  Alert.alert(BACKGROUND_POWER_PROMPT.title, BACKGROUND_POWER_PROMPT.body, [
    { text: BACKGROUND_POWER_PROMPT.dismiss, style: 'cancel' },
    {
      text: BACKGROUND_POWER_PROMPT.confirm,
      onPress: () => {
        requestBackgroundDeliveryUnrestricted()
      }
    }
  ])
}
