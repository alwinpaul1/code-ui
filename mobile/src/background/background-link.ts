import { peekLiveHostClient } from '../transport/live-host-clients'
import { AppState, Platform } from 'react-native'
import {
  isBackgroundLinkSupported,
  isBackgroundLinkUnrestricted,
  requestBackgroundLinkUnrestricted,
  startBackgroundLink,
  stopBackgroundLink
} from '@codeui/expo-background-link'
import { subscribeToDesktopNotifications } from '../notifications/mobile-notifications'
import {
  clearBackgroundPowerRequested,
  loadBackgroundPowerRequestedAgo,
  loadBackgroundPowerAskedAgo,
  loadBackgroundPowerLastSeen,
  loadPushNotificationsEnabled,
  saveBackgroundPowerAskedNow,
  saveBackgroundPowerLastSeen
} from '../storage/preferences'
import { adviseBackgroundPowerRequestOutcome } from './background-power-request-outcome'
import { adviseBackgroundDeliveryPower } from './background-delivery-power'
import { openBackgroundPowerPrompt } from './background-power-prompt-store'
import { subscribeConnectionRevivalTriggers } from '../transport/connection-revival-triggers'
import { openHostLogicalClient } from '../transport/host-logical-client'
import { loadHosts } from '../transport/host-store'
import { connectionLogStore } from '../transport/persisted-connection-log-store'
import type { RpcClient } from '../transport/rpc-client'
import type { HostProfile } from '../transport/types'
import { loadBackgroundDeliveryEnabled } from './background-link-preference'
import { forwardBackgroundClientRevival } from './background-client-revival'
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
  // The process-level watcher replaces the relay on a network change.
  // This subscription is only for the screen coming back, when that watcher
  // has already handed the socket over.
  const unsubscribeRevival = subscribeConnectionRevivalTriggers((reason) => {
    forwardBackgroundClientRevival(reason, (next) => client.notifyForeground(next))
  })
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
  // The screen's own listener is gone once Recents destroys it, and while the
  // screen is only backgrounded this is the listener that stays scheduled.
  // A network change replaces the relay here so the next open is already connected.
  subscribeConnectionRevivalTriggers((reason) => {
    if (reason === 'network-change') {
      watcher?.reconnectForNetworkChange()
    }
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
 * start a foreground service from the background — which is why it runs on
 * launch and on the toggle, never from a background transition.
 *
 * "On launch" was this comment's claim long before it was true: the toggle was
 * the ONLY caller, so a killed service stayed dead until somebody found
 * Settings and flipped the switch twice. background-link-healing.ts is the
 * launch half, and BackgroundLinkBootReceiver the reboot one.
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
/**
 * Report whether an exemption request the reader made actually landed.
 *
 * Called on every return to the foreground, because that is when they come back
 * from Android's screen. Without it a failed grant looked identical to a
 * successful one: the sheet closed, nothing changed, and the same ask returned
 * later as if the app had not been listening.
 */
export async function reportBackgroundDeliveryPowerOutcome(): Promise<void> {
  if (!isBackgroundDeliveryAvailable()) {
    return
  }
  const requestedAgo = await loadBackgroundPowerRequestedAgo()
  if (requestedAgo === null) {
    return
  }
  const outcome = adviseBackgroundPowerRequestOutcome({
    requestedAgo,
    unrestricted: isBackgroundDeliveryUnrestricted()
  })
  if (outcome === 'none') {
    return
  }
  // Cleared either way: the question has been answered, and a marker left
  // behind would report the same trip again on the next foreground.
  await clearBackgroundPowerRequested()
  if (outcome === 'granted') {
    // Nothing to say. The thing they asked for happened, and the settings row
    // has already stopped showing.
    await saveBackgroundPowerLastSeen(true)
    return
  }
  openBackgroundPowerPrompt('not-taken')
}

export async function askBackgroundDeliveryPowerOnOpen(): Promise<void> {
  if (!isBackgroundDeliveryAvailable()) {
    return
  }
  const [deliveryOn, askedAgo, wasUnrestricted] = await Promise.all([
    syncBackgroundLinkFromPreferences(),
    loadBackgroundPowerAskedAgo(),
    loadBackgroundPowerLastSeen()
  ])
  const unrestricted = isBackgroundDeliveryUnrestricted()
  // Recorded every open, so the next one can tell a grant that was taken away
  // from one that was never given.
  await saveBackgroundPowerLastSeen(unrestricted)
  const advice = adviseBackgroundDeliveryPower({
    deliveryOn,
    unrestricted,
    askedAgo,
    wasUnrestricted
  })
  if (!advice.promptOnOpen) {
    return
  }
  // Marked asked BEFORE showing it: a dismissal must not bring it back on the
  // next launch.
  await saveBackgroundPowerAskedNow()
  // Explained first, in the app's own sheet. Android's dialog names the cost and
  // not the benefit, so alone it is dismissed without being read, and the late
  // notifications that follow are never connected back to it.
  openBackgroundPowerPrompt()
}
