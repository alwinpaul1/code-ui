import type { BackgroundTaskKind, BackgroundTaskStatus } from './mobile-background-tasks'

// How a background task reads on screen. Split out from the derivation because
// it is presentation only: nothing here decides whether a task is running.

/** "19m 8s" while a job runs; "2h 19m" once it is past the hour. Null when the
 *  transcript never said when the task started — no invented stopwatch. */
export function formatBackgroundTaskElapsed(elapsedMs: number | null): string | null {
  if (elapsedMs === null) {
    return null
  }
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000)
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${totalSeconds % 60}s`
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function formatRunningTaskCount(count: number): string {
  return `${count} running task${count === 1 ? '' : 's'}`
}

export function backgroundTaskKindLabel(kind: BackgroundTaskKind): string {
  switch (kind) {
    case 'agent':
      return 'Agent'
    case 'shell':
      return 'Shell'
    case 'monitor':
      return 'Monitor'
    case 'workflow':
      return 'Workflow'
    case 'unknown':
      return 'Task'
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

export function backgroundTaskStatusLabel(status: BackgroundTaskStatus): string {
  return status === 'failed' ? 'Failed' : status === 'completed' ? 'Completed' : 'Running'
}
