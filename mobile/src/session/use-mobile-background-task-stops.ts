import { useCallback, useRef, useState } from 'react'

/** One Stop as the sheet sends it: resolves true only when the host confirmed the task stopped
 *  (`cancelled: true`), false for a refusal, a lost answer or nothing stopped. `report`, when given,
 *  is where this Stop's failure is said (Stop all collects them per task). */
export type MobileBackgroundTaskStop = (taskId: string, report?: (message: string) => void) => Promise<boolean>

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
  /** The host connection the presses go out on. A new one lets every hold go: an answer that
   *  arrives for a Stop sent on the old connection no longer holds a row. */
  connection?: number | null
}): {
  holding: ReadonlySet<string>
  /** Sends one Stop; resolves as `stop` does, or false when it was not sent (held, no handler). */
  onStop: MobileBackgroundTaskStop
} {
  const { runningIds, stop } = args
  const connection = args.connection ?? null
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(NO_TASKS)
  const inFlightRef = useRef<ReadonlySet<string>>(NO_TASKS)
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(NO_TASKS)
  const connectionRef = useRef(connection)
  const [heldOn, setHeldOn] = useState(connection)
  const reconnected = heldOn !== connection
  if (reconnected) {
    setHeldOn(connection)
    setConfirmed(NO_TASKS)
    inFlightRef.current = NO_TASKS
    setInFlight(NO_TASKS)
  }
  connectionRef.current = connection
  const listed = new Set(runningIds)
  // On the reconnect frame every hold is already let go: the drop below must not put them back.
  const stillListed = reconnected ? NO_TASKS : new Set([...confirmed].filter((id) => listed.has(id)))
  if (!reconnected && !sameSet(stillListed, confirmed)) {
    // Render-time drop: a confirmed row that left is forgotten, so its return offers Stop again.
    setConfirmed(stillListed)
  }
  const updateInFlight = (next: ReadonlySet<string>): void => {
    inFlightRef.current = next
    setInFlight(next)
  }
  const onStop = useCallback(
    async (taskId: string, report?: (message: string) => void): Promise<boolean> => {
      // The ref closes the same-frame double tap that state alone would let through.
      if (!stop || inFlightRef.current.has(taskId)) {
        return false
      }
      updateInFlight(new Set([...inFlightRef.current, taskId]))
      const sentOn = connectionRef.current
      try {
        const done = await stop(taskId, report)
        if (done && connectionRef.current === sentOn) {
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
    reconnected || (inFlight.size === 0 && stillListed.size === 0)
      ? NO_TASKS
      : new Set([...inFlight, ...stillListed])
  return { holding, onStop }
}
