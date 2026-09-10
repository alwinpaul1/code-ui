import { AppRegistry } from 'react-native'
import { BACKGROUND_LINK_TASK_KEY } from '@codeui/expo-background-link'
import { syncBackgroundLinkFromPreferences } from './background-link'
import { parkBackgroundLinkTask, releaseBackgroundLinkTask } from './background-link-task-hold'

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
AppRegistry.registerHeadlessTask(BACKGROUND_LINK_TASK_KEY, () => async () => {
  try {
    const on = await syncBackgroundLinkFromPreferences()
    if (!on) {
      // Delivery was switched off before the service got here; returning lets
      // the service stop itself and Android release the lock.
      return
    }
    await parkBackgroundLinkTask()
  } catch {
    // Why swallow: an unhandled rejection here would leave React Native to
    // decide whether the task ever finishes. Returning ends it now, which is
    // what releases the lock. The link is re-synced on the next foreground.
  } finally {
    releaseBackgroundLinkTask()
  }
})
