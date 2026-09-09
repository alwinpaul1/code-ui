import { AppRegistry } from 'react-native'
import { BACKGROUND_LINK_TASK_KEY } from '@codeui/expo-background-link'
import { syncBackgroundLinkFromPreferences } from './background-link'

// Why a headless task that never resolves: React Native pauses JS timers while
// no Activity is resumed unless a headless task is active. The foreground
// service starts this task; keepalive pings, reconnects and request timeouts
// on the background link all depend on it running.
AppRegistry.registerHeadlessTask(BACKGROUND_LINK_TASK_KEY, () => async () => {
  const on = await syncBackgroundLinkFromPreferences()
  if (!on) {
    // Delivery was switched off before the service got here; finishing the
    // task lets the service stop itself.
    return
  }
  await new Promise<void>(() => {})
})
