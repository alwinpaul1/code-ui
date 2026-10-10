import { useCallback } from 'react'
import { Alert } from 'react-native'
import type { BackgroundTask } from './mobile-background-tasks'
import type { MobileBackgroundTaskStop } from './use-mobile-background-task-stops'

/** The running rows Stop all may stop: those that take their own Stop and are not already
 *  stopping. */
export function stopAllTargets(
  running: readonly BackgroundTask[],
  holding: ReadonlySet<string>
): BackgroundTask[] {
  return running.filter((task) => task.stoppable !== false && !holding.has(task.id))
}

/** The sheet's failure line for a Stop all: how many did not stop, then one line per task, in the
 *  words its own Stop reported. */
export function stopAllFailureText(
  failures: readonly { title: string; message: string }[],
  attempted: number
): string {
  const head = `${failures.length} of ${attempted} ${attempted === 1 ? 'task' : 'tasks'} didn't stop.`
  return [head, ...failures.map(({ title, message }) => `${title}: ${message}`)].join('\n')
}

/**
 * "Stop all" (the user's ask, 2026-10-10, from upstream's strip): each target goes through the same
 * per-task Stop as its own button, so the holds and the host's answers are the ones a single press
 * gets. More than one task is confirmed first. A task whose Stop said why it failed (a refusal, an
 * unconfirmed answer) is named on the sheet's failure line. One the host answered with nothing
 * stopped and no words is not: that task had already ended, and its row leaves on its own.
 */
export function useMobileBackgroundTasksStopAll(args: {
  targets: readonly BackgroundTask[]
  onStop: MobileBackgroundTaskStop
  onFailed?: (text: string) => void
}): () => void {
  const { targets, onStop, onFailed } = args
  return useCallback(() => {
    const batch = [...targets]
    if (batch.length === 0) {
      return
    }
    const run = (): void => {
      const failures: { title: string; message: string }[] = []
      void Promise.all(
        batch.map(async (task) => {
          let said: string | null = null
          const done = await onStop(task.id, (message) => {
            said = message
          })
          if (!done && said !== null) {
            failures.push({ title: task.title, message: said })
          }
        })
      ).then(() => {
        if (failures.length > 0) {
          // In the order the rows are listed, not the order the answers came back.
          const order = new Map(batch.map((task, index) => [task.title, index]))
          failures.sort((a, b) => (order.get(a.title) ?? 0) - (order.get(b.title) ?? 0))
          onFailed?.(stopAllFailureText(failures, batch.length))
        }
      })
    }
    if (batch.length === 1) {
      run()
      return
    }
    Alert.alert(`Stop ${batch.length} background tasks?`, 'Each one is stopped on its own.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop all', style: 'destructive', onPress: run }
    ])
  }, [onFailed, onStop, targets])
}
