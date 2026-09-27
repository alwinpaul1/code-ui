import type { ConnectionLogEntry } from '../transport/types'
import { appPauseLogEntry } from './app-pause-detector'
import type { BackgroundServiceStop } from './background-service-stop'

export type AppPauseHandlerDependencies = {
  now: () => number
  /** Read on waking, not during the pause. */
  backgroundState: () => { serviceRunning: boolean; unrestricted: boolean }
  lastServiceStop: () => BackgroundServiceStop | null
  /** Whether the user wants the service running (delivery and notifications on). */
  loadDeliveryOn: () => Promise<boolean>
  /** Starts the foreground service. Android may refuse a background start by throwing. */
  startService: () => void
  /** One line into every host's connection log. */
  record: (entry: ConnectionLogEntry) => void
}

/**
 * What the app does when it finds out Android paused it: log the pause, and
 * bring the background service back if it should be running and is not.
 *
 * Why the restart lives here: until now the only moments that restarted a
 * dead service were an open of the app and a reboot. On 2026-09-27 a Pixel
 * (battery unrestricted) woke every hour for the update check, found the
 * service dead, logged it, and went back to sleep with it still dead until
 * someone opened the app. A pause is noticed exactly when something has
 * woken the app, so it is a chance to start the service without anyone
 * opening it.
 *
 * Android 12+ allows that start from the background only for an app exempt
 * from battery optimisation. The start is tried either way: optimised, it
 * usually throws, and the line that says so is the useful outcome.
 */
export async function handleAppPause(
  pause: { from: number; to: number },
  dependencies: AppPauseHandlerDependencies
): Promise<void> {
  const background = dependencies.backgroundState()
  const stop = background.serviceRunning ? null : dependencies.lastServiceStop()
  dependencies.record(appPauseLogEntry(pause, background, stop))
  if (background.serviceRunning) {
    return
  }
  let deliveryOn: boolean
  try {
    deliveryOn = await dependencies.loadDeliveryOn()
  } catch (error) {
    // Not guessed: starting a service the user switched off is worse than
    // leaving one off that they wanted.
    dependencies.record(
      restartEntry(dependencies.now(), 'warn', 'Could not restart the background service', [
        `Reading the background delivery setting failed: ${describeError(error)}.`,
        OPEN_TO_RESTART
      ])
    )
    return
  }
  if (!deliveryOn) {
    return
  }
  try {
    dependencies.startService()
  } catch (error) {
    dependencies.record(
      restartEntry(dependencies.now(), 'warn', 'Could not restart the background service', [
        `Android refused to start it from the background: ${describeError(error)}.`,
        background.unrestricted
          ? ''
          : 'The battery use is optimised, and Android refuses a background start then; Unrestricted lifts that.',
        OPEN_TO_RESTART
      ])
    )
    return
  }
  dependencies.record(
    restartEntry(dependencies.now(), 'info', 'Restarted the background service', [
      'It was not running on waking and background delivery is on, so the app started it again.'
    ])
  )
}

const OPEN_TO_RESTART = 'It starts again the next time the app is opened.'

function restartEntry(
  ts: number,
  level: ConnectionLogEntry['level'],
  message: string,
  sentences: string[]
): ConnectionLogEntry {
  return {
    id: `background-service-restart-${ts}`,
    ts,
    level,
    message,
    detail: sentences.filter(Boolean).join(' ')
  }
}

function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/\s+/g, ' ').trim().replace(/\.$/, '') || 'no message'
}
