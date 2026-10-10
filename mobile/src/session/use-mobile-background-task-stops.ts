import { useCallback, useRef, useState } from 'react'

/** One Stop as the sheet sends it: resolves true only when the host confirmed the task stopped
 *  (`cancelled: true`), false for a refusal, a lost answer or nothing stopped. */
export type MobileBackgroundTaskStop = (taskId: string) => Promise<boolean>

const NO_TASKS: ReadonlySet<string> = new Set()

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

/**
 * The sheet's Stop presses: which rows hold their button, and the press that sends one (Orca
 * #26780, upstream's `use-mobile-background-task-stops.ts`, mapped onto this app's sheet). A press on
 * its way holds its row; a Stop the host confirmed keeps holding it while the sheet still lists the
 * task, so it never looks pressable on a row that is already stopping. A row that leaves and comes
 * back is a task the Stop did not end, so it offers Stop again. No timer: the hold is derived.
 */
export function useMobileBackgroundTaskStops(args: {
  /** Ids the sheet lists as running now. */
  runningIds: readonly string[]
  stop: MobileBackgroundTaskStop | undefined
}): {
  holding: ReadonlySet<string>
  /** Sends one Stop; resolves as `stop` does, or false when it was not sent (held, no handler). */
  onStop: (taskId: string) => Promise<boolean>
} {
  const { runningIds, stop } = args
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(NO_TASKS)
  const inFlightRef = useRef<ReadonlySet<string>>(NO_TASKS)
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(NO_TASKS)
  const listed = new Set(runningIds)
  const stillListed = new Set([...confirmed].filter((id) => listed.has(id)))
  if (!sameSet(stillListed, confirmed)) {
    // Render-time drop: a confirmed row that left is forgotten, so its return offers Stop again.
    setConfirmed(stillListed)
  }
  const updateInFlight = (next: ReadonlySet<string>): void => {
    inFlightRef.current = next
    setInFlight(next)
  }
  const onStop = useCallback(
    async (taskId: string): Promise<boolean> => {
      // The ref closes the same-frame double tap that state alone would let through.
      if (!stop || inFlightRef.current.has(taskId)) {
        return false
      }
      updateInFlight(new Set([...inFlightRef.current, taskId]))
      try {
        const done = await stop(taskId)
        if (done) {
          setConfirmed((held) => new Set([...held, taskId]))
        }
        return done
      } catch {
        return false
      } finally {
        const next = new Set(inFlightRef.current)
        next.delete(taskId)
        updateInFlight(next)
      }
    },
    [stop]
  )
  const holding =
    inFlight.size === 0 && stillListed.size === 0 ? NO_TASKS : new Set([...inFlight, ...stillListed])
  return { holding, onStop }
}
