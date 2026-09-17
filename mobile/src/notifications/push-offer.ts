import type { RpcClient } from '../transport/rpc-client'
import { loadRemotePushEnabled } from '../storage/preferences'
import { registerPushBackgroundTask } from './push-background-task'
import { registerPushForHost, type PushRegistrationOutcome } from './push-registration'

/** The last answer a host gave, so a settings screen can say why push is off. */
const lastOutcomeByHost = new Map<string, PushRegistrationOutcome>()

export function lastPushRegistrationOutcome(hostId: string): PushRegistrationOutcome | undefined {
  return lastOutcomeByHost.get(hostId)
}

/**
 * Offer this device's push token to a host that has just connected, if the user
 * has asked for remote push.
 *
 * Never throws and never prompts. It runs inside a connection effect, where a
 * rejection becomes an unhandled promise and a permission dialog would appear
 * out of nowhere — `acquirePushToken` only ensures a permission the user has
 * already been asked for.
 */
export async function offerPushTokenToHost(client: RpcClient, hostId: string): Promise<void> {
  try {
    if (!(await loadRemotePushEnabled())) {
      return
    }
    // Why here and not at app start: registering the task on a build with no
    // Firebase credentials fails, and doing it only for someone who asked for
    // push keeps that failure off the start path of every other install.
    await registerPushBackgroundTask()
    lastOutcomeByHost.set(hostId, await registerPushForHost(client))
  } catch {
    // See above.
  }
}
