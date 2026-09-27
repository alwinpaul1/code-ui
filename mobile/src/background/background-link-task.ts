import { AppRegistry } from 'react-native'
import { BACKGROUND_LINK_TASK_KEY } from '@codeui/expo-background-link'
import { syncBackgroundLinkFromPreferences } from './background-link'
import { parkBackgroundLinkTask, type ParkedBackgroundLinkTask } from './background-link-task-hold'

// Why a headless task that parks instead of returning: React Native pauses JS
// timers while no Activity is resumed unless a headless task is active. The
// foreground service starts this task; keepalive pings, reconnects and request
// timeouts on the background link all depend on it running. That is what makes
// a notification arrive while the app is closed.
//
// Why it must still be able to end: Android holds a partial wake lock for as
// long as the task runs and releases it only once the task finishes and the
// service stops. The task config carries no timeout, so nothing else will ever
// end this one. Every exit below is deliberate, and the `finally` guarantees
// one even if the startup sync throws.
//
// Why the `finally` releases only this task's own park: it used to release
// whatever was parked. With two link tasks alive (the service started a second
// while the first was parked, 2026-09-27) the first one's cleanup ended the
// second, and the service stopped with nothing left running.
AppRegistry.registerHeadlessTask(BACKGROUND_LINK_TASK_KEY, () => async () => {
  let own: ParkedBackgroundLinkTask | null = null
  try {
    const on = await syncBackgroundLinkFromPreferences()
    if (!on) {
      // Delivery was switched off before the service got here; returning lets
      // the service stop itself and Android release the lock.
      return
    }
    own = parkBackgroundLinkTask()
    await own.parked
  } catch {
    // Why swallow: an unhandled rejection here would leave React Native to
    // decide whether the task ever finishes. Returning ends it now, which is
    // what releases the lock. The link is re-synced on the next foreground.
  } finally {
    own?.release()
  }
})
