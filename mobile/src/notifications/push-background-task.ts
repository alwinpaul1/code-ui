import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { handlePushDelivery } from './push-background-delivery'

export const PUSH_NOTIFICATION_TASK_KEY = 'codeui-push-notification'

// Why at module scope, and why this module is imported from index.ts: when a
// push arrives at a killed app, Android starts the JS bundle headless and
// nothing under app/ is ever rendered. A defineTask inside a route module would
// register after the delivery it was meant to handle, which is to say never.
//
// This is the same reason background-link-task.ts sits where it does.
TaskManager.defineTask(PUSH_NOTIFICATION_TASK_KEY, async ({ data, error }) => {
  if (error) {
    // Nothing to render and nowhere to report it; see handlePushDelivery.
    return
  }
  await handlePushDelivery(data)
})

/**
 * Ask the platform to run the task above for data messages.
 *
 * Never throws. On a build with no Firebase credentials this fails, and it must
 * fail as "no push" rather than as an exception on the app-start path. The
 * returned boolean is for a caller that wants to say which it was.
 */
export async function registerPushBackgroundTask(): Promise<boolean> {
  try {
    await Notifications.registerTaskAsync(PUSH_NOTIFICATION_TASK_KEY)
    return true
  } catch {
    return false
  }
}
