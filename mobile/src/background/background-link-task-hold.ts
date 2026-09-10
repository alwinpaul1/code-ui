/**
 * The headless task's parking brake.
 *
 * Why it exists: Android holds a partial wake lock for as long as a React
 * Native headless task is running, and releases it only when the task
 * finishes and the service stops. Code UI's task deliberately never returns
 * while background delivery is on — that is what keeps JS timers alive so
 * keepalive pings, request timeouts and reconnects still run with the screen
 * off, and it is why notifications arrive at all when the app is closed.
 *
 * The danger is the other half: a task parked forever with no way to end it.
 * Its config carries no timeout, so nothing else will ever finish it, and a
 * lock held after the work is over is pure battery drain. Everything that
 * ends background delivery releases the brake here, the task returns, React
 * Native reports it finished, the service stops itself and Android releases
 * the lock.
 */

let release: (() => void) | null = null

/** Park the caller until `releaseBackgroundLinkTask` is called. */
export function parkBackgroundLinkTask(): Promise<void> {
  // A second park would strand the first; release it rather than leak it.
  releaseBackgroundLinkTask()
  return new Promise<void>((resolve) => {
    release = resolve
  })
}

/** End a parked task, if one is parked. Safe to call at any time. */
export function releaseBackgroundLinkTask(): void {
  const parked = release
  release = null
  parked?.()
}

/** Test-only: whether a task is currently parked. */
export function isBackgroundLinkTaskParked(): boolean {
  return release !== null
}
