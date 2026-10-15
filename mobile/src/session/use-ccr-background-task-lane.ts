import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ccrBackgroundTaskRows, deriveCcrBackgroundTasks } from './ccr-background-tasks'
import { stopCcrBackgroundTaskOnLink } from './ccr-background-task-stop'
import type { ClaudeChatLiveStream } from './claude-chat-live'
import type { BackgroundTask, BackgroundTasks } from './mobile-background-tasks'

/** The sheet's rows from Anthropic's stream while it is live (the list the Claude app shows and
 *  the one the header's running count comes from); null when it is not, and the desktop's lane
 *  stands in. */
export function useCcrBackgroundTaskLane(stream: ClaudeChatLiveStream | null, now: number): BackgroundTasks | null {
  const events = stream?.events ?? null
  const tasks = useMemo(() => (events ? deriveCcrBackgroundTasks(events) : null), [events])
  return useMemo(() => (tasks ? ccrBackgroundTaskRows(tasks, now) : null), [now, tasks])
}

export type CcrStopTask = (stream: ClaudeChatLiveStream, taskId: string) => Promise<boolean>

export const defaultCcrStopTask: CcrStopTask = (stream, taskId) => stopCcrBackgroundTaskOnLink(stream.accountId, stream.sessionId, taskId)

/** How long a row reads "Stopping…" after Anthropic took the Stop, unless it ends first. The app
 *  clears its own after a delay too (lt2.java 0x0080, `zfi.F`); its length was not read. */
export const CCR_STOP_HOLD_MS = 15_000

export const CCR_STOP_FAILED_LINE = 'Couldn’t stop the task. Try again.'

/**
 * The sheet's Stop on Anthropic's lane, as the app's (`su8.stopBackgroundTask`, lt2.java): the row
 * reads "Stopping…" from the press; a POST Anthropic refused clears that and says
 * "Couldn’t stop the task. Try again." (`ccr_background_task_stop_failed`); a taken one holds it
 * until the row leaves Running or the hold runs out.
 */
export function useCcrTaskStops(stream: ClaudeChatLiveStream | null, running: readonly BackgroundTask[], stopTask: CcrStopTask = defaultCcrStopTask) {
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set())
  const [failed, setFailed] = useState<string | null>(null)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const release = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setStopping((held) => {
      if (!held.has(id)) {
        return held
      }
      const next = new Set(held)
      next.delete(id)
      return next
    })
  }, [])
  // A row that left Running no longer needs its "Stopping…".
  useEffect(() => {
    const live = new Set(running.map((task) => task.id))
    for (const id of stopping) {
      if (!live.has(id)) {
        release(id)
      }
    }
  }, [release, running, stopping])
  useEffect(() => {
    const held = timers.current
    return () => {
      for (const timer of held.values()) {
        clearTimeout(timer)
      }
      held.clear()
    }
  }, [])
  const stop = useCallback(
    (task: BackgroundTask) => {
      if (!stream || stopping.has(task.id)) {
        return
      }
      setFailed(null)
      setStopping((held) => new Set(held).add(task.id))
      void stopTask(stream, task.id).catch(() => false).then((taken) => {
        if (!taken) {
          release(task.id)
          setFailed(CCR_STOP_FAILED_LINE)
          return
        }
        timers.current.set(
          task.id,
          setTimeout(() => release(task.id), CCR_STOP_HOLD_MS)
        )
      })
    },
    [release, stopTask, stopping, stream]
  )
  return { stopping, failed, stop: stream ? stop : null }
}
