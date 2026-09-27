/**
 * Why the background service last stopped, from what the native side left
 * behind (BackgroundLinkService.lastStop).
 *
 * Why it exists: on 2026-09-27 a Pixel logged "background service not
 * running" on every hourly wake overnight, and not one line said when it had
 * stopped or why. Nothing logged a stop, and the pause line only read the state
 * on waking. The service now writes down each stop from onDestroy. A process
 * that is killed never gets there, so for that case the native side also hands
 * back the process's last ApplicationExitInfo (Android 11+).
 */

/** What the native side returns. Every field may be missing or null. */
export type BackgroundServiceStopRecord = {
  startedAt?: number | null
  stoppedAt?: number | null
  cause?: string | null
  taskRemovedAt?: number | null
  exitAt?: number | null
  exitReason?: number | null
  exitDescription?: string | null
}

export type BackgroundServiceStop = { at: number; cause: string }

const CAUSE_WORDS: Record<string, string> = {
  'task-ended': 'its task ended',
  // applyBackgroundDelivery(false) is the only caller, and it runs when either
  // switch is off.
  'js-stop': 'the app stopped it (background delivery or notifications are off)',
  timeout: "Android's foreground-service time limit ran out",
  'task-removed': 'Android stopped it after the app was swiped from Recents',
  external: 'Android stopped it'
}

// ApplicationExitInfo.REASON_* values.
const EXIT_REASON_WORDS: Record<number, string> = {
  0: 'reason unknown',
  1: 'the app exited',
  2: 'killed by a signal',
  3: 'low memory',
  4: 'a crash',
  5: 'a native crash',
  6: 'not responding',
  7: 'it failed to start',
  8: 'a permission change',
  9: 'excessive resource use',
  10: 'the user asked',
  11: 'the user stopped it',
  12: 'a process it depended on died',
  13: 'killed by the system',
  14: 'killed while frozen',
  15: 'the app was disabled or changed',
  16: 'the app was updated'
}

/**
 * The stop that explains a service that is not running now, or null when
 * nothing recorded explains it. Only a stop from the latest run counts: one
 * older than the last start belongs to a run that was followed by another.
 */
export function describeBackgroundServiceStop(
  record: BackgroundServiceStopRecord | null
): BackgroundServiceStop | null {
  if (!record) {
    return null
  }
  const startedAt = time(record.startedAt)
  const stoppedAt = time(record.stoppedAt)
  if (stoppedAt !== null && (startedAt === null || stoppedAt >= startedAt)) {
    return { at: stoppedAt, cause: causeWords(record.cause) }
  }
  const exitAt = time(record.exitAt)
  if (startedAt === null || exitAt === null || exitAt < startedAt) {
    return null
  }
  const swipedAt = time(record.taskRemovedAt)
  const swiped = swipedAt !== null && swipedAt >= startedAt ? ' after the app was swiped from Recents' : ''
  return { at: exitAt, cause: `Android ended the app's process (${exitWords(record)})${swiped}` }
}

function causeWords(cause: unknown): string {
  if (typeof cause !== 'string') {
    return 'it stopped (no cause recorded)'
  }
  return CAUSE_WORDS[cause] ?? `it stopped (${cause})`
}

function exitWords(record: BackgroundServiceStopRecord): string {
  const reason =
    typeof record.exitReason === 'number'
      ? (EXIT_REASON_WORDS[record.exitReason] ?? `reason ${record.exitReason}`)
      : 'reason unknown'
  const description = typeof record.exitDescription === 'string' ? record.exitDescription.trim() : ''
  return description ? `${reason}: ${description}` : reason
}

function time(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}
