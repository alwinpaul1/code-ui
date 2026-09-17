import { AppState } from 'react-native'
import { syncBackgroundLinkFromPreferences } from './background-link'

/**
 * Re-derive the link's running state at every moment the app is allowed to
 * start a foreground service: now, and each time it returns to the foreground.
 *
 * Why it did not exist and had to: `applyBackgroundDelivery` had exactly one
 * caller, the Settings toggle, and `syncBackgroundLinkFromPreferences` had one,
 * the headless task — which only runs once the service is already up. Nothing
 * on the launch path called either, though background-link.ts claims "the app
 * calls it on launch and on the toggle". Once Android killed the service the
 * only way back was Settings, toggle off, toggle on. Nobody finds that, so to
 * the user notifications had simply stopped for good.
 *
 * Why 'active' and nothing else: Android refuses a foreground-service start
 * from the background, so syncing on the way out would throw and achieve
 * nothing. Coming back is the one reliable moment the start is permitted.
 *
 * Why it is safe to call repeatedly: `applyBackgroundDelivery` is idempotent —
 * a second start only refreshes the service's notification text, and a sync
 * while delivery is off stops a service that is already stopped.
 *
 * This is the companion to BackgroundLinkBootReceiver. That one covers reboots
 * and updates, where there is no app to return to; this covers every other
 * kill, which is most of them.
 */
export function startBackgroundLinkHealing(): () => void {
  heal()
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      heal()
    }
  })
  return () => subscription.remove()
}

function heal(): void {
  // Swallowed: this runs on the launch path, where a rejection is an unhandled
  // promise in release and a redbox over the app in development. An unreadable
  // preference costs this attempt, and the next foreground tries again.
  void syncBackgroundLinkFromPreferences().catch(() => undefined)
}
