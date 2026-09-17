import type { PushRegistrationOutcome } from './push-registration'

/**
 * The last answer each host gave about this device's push token, so a settings
 * screen can say why push is off rather than showing nothing.
 *
 * Why its own module and not a few lines in push-offer: host removal has to
 * clear this, and push-offer reaches expo-notifications and expo-task-manager
 * through push-background-task. Importing it from the removal path pulled the
 * whole Expo runtime into a module that only deletes a host, which broke
 * host-removal-lifecycle.test.ts at collection with "Cannot find module
 * './ImportMetaRegistry'". A store with one dependency — a type — can be read
 * from anywhere.
 */
const lastOutcomeByHost = new Map<string, PushRegistrationOutcome>()

export function recordPushRegistrationOutcome(
  hostId: string,
  outcome: PushRegistrationOutcome
): void {
  lastOutcomeByHost.set(hostId, outcome)
}

export function lastPushRegistrationOutcome(hostId: string): PushRegistrationOutcome | undefined {
  return lastOutcomeByHost.get(hostId)
}

/** Drop a removed host's answer, so a re-pair does not show the old host's reason. */
export function forgetPushRegistrationOutcome(hostId: string): void {
  lastOutcomeByHost.delete(hostId)
}
