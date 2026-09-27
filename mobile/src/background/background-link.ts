import { peekLiveHostClient } from '../transport/live-host-clients'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import {
  isBackgroundLinkRunning,
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
import type { ConnectionLogEntry, HostProfile } from '../transport/types'
import { loadBackgroundDeliveryEnabled } from './background-link-preference'
import { forwardBackgroundClientRevival } from './background-client-revival'
import {
  createBackgroundNotificationWatcher,
  type BackgroundNotificationWatcher
} from './background-notification-watcher'
import { releaseBackgroundLinkTask } from './background-link-task-hold'
import { AppPauseDetector } from './app-pause-detector'
import { handleAppPause } from './app-pause-handler'
import { promptAfterPause } from './background-power-after-pause'
import {
  describeBackgroundServiceStop,
  type BackgroundServiceStop,
  type BackgroundServiceStopRecord
} from './background-service-stop'
import { defaultCancelTimer, defaultScheduleTimer } from '../transport/timer-scheduler'

const SERVICE_TITLE = 'Code UI'
const SERVICE_TEXT = 'Listening for agent notifications'

let watcher: BackgroundNotificationWatcher | null = null

// Once per process, beside the watcher: a pause is what stops it listening, and
// nothing else in the log can show one.
const pauseDetector = new AppPauseDetector({
  now: Date.now,
  setTimer: defaultScheduleTimer,
  clearTimer: defaultCancelTimer,
  onPause: (pause) => {
    // Say so now, while the cost is concrete; shown when the screen is up.
    if (promptAfterPause({ pausedMs: pause.to - pause.from, unrestricted: isBackgroundDeliveryUnrestricted() })) {
      openBackgroundPowerPrompt('paused', pause.to - pause.from)
    }
    void handleAppPause(pause, {
      now: Date.now,
      backgroundState: backgroundDeliveryState,
      lastServiceStop: readBackgroundServiceStop,
      loadDeliveryOn: loadBackgroundDeliveryOn,
      startService: () => applyBackgroundDelivery(true),
      record: recordOnEveryHost
    }).catch(() => undefined)
  }
})

function log(message: string, detail = ''): void {
  console.log(`[background-link] ${message}`, detail)
}

/** A line that is not about one host's connection, so every host's log gets it. */
function recordOnEveryHost(entry: ConnectionLogEntry): void {
  log(entry.message, entry.detail)
  void loadHosts()
    .then((hosts) => {
      for (const host of hosts) {
        connectionLogStore.append(host.id, entry)
      }
    })
    .catch(() => undefined)
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
  if (isBackgroundDeliveryAvailable()) {
    pauseDetector.start()
  }
  return watcher
}

/** What keeps the app running with the screen off, for the diagnostics report. */
export function backgroundDeliveryState(): { serviceRunning: boolean; unrestricted: boolean } {
  return {
    serviceRunning: isBackgroundLinkRunning(),
    unrestricted: isBackgroundDeliveryUnrestricted()
  }
}

// Why the module is looked up here instead of through @codeui/expo-background-link:
// the copy of that package the app compiles against is a pnpm snapshot under
// node_modules, refreshed only by `pnpm install`, and a build made from a stale
// snapshot has no `lastStop`. Checked for, it costs that build its stop reason
// ("stop reason unknown") instead of throwing inside the pause handler.
type NativeServiceStopReader = { lastStop?: () => BackgroundServiceStopRecord }
const nativeStopReader: NativeServiceStopReader | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeServiceStopReader>('BackgroundLink') : null

/** When and why the background service last stopped, if it said. */
export function readBackgroundServiceStop(): BackgroundServiceStop | null {
  try {
    // Called on the module, not detached from it: a native function may need its receiver.
    return typeof nativeStopReader?.lastStop === 'function'
      ? describeBackgroundServiceStop(nativeStopReader.lastStop())
      : null
  } catch {
    // Unreadable preferences cost the line its stop reason, nothing more.
    return null
  }
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
 * watcher behind it. Call it from the foreground — Android 12+ refuses to
 * start a foreground service from the background, by throwing — which is why
 * it runs on launch and on the toggle, never from a background transition.
 * The one deliberate exception is the pause handler (app-pause-handler.ts): an
 * app exempt from battery optimisation IS allowed a background start, so it
 * tries, and logs the refusal when there is one.
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
  const on = await loadBackgroundDeliveryOn()
  applyBackgroundDelivery(on)
  return on
}

/** Whether the user wants the service running: background delivery and notifications both on. */
export async function loadBackgroundDeliveryOn(): Promise<boolean> {
  const [delivery, push] = await Promise.all([
    loadBackgroundDeliveryEnabled(),
    loadPushNotificationsEnabled()
  ])
  return delivery && push
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
