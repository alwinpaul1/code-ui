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
 *
 * Each park hands back its OWN release. A task cleaning up after itself must
 * end only its own park, never "whatever is parked now": on 2026-09-27 the
 * service started a second task while the first was parked, the second park
 * let the first go, and the first task's cleanup then released the second.
 * Both ended, the service found no task left, and it stopped itself seconds
 * after the app was opened.
 */

let parkedRelease: (() => void) | null = null

export type ParkedBackgroundLinkTask = {
  /** Settles when this park is released, by its own release or a global one. */
  parked: Promise<void>
  /** Ends this park and no other. Safe to call more than once. */
  release: () => void
}

/** Park the caller until it is released. */
export function parkBackgroundLinkTask(): ParkedBackgroundLinkTask {
  // A second park would strand the first; release it rather than leak it.
  releaseBackgroundLinkTask()
  let settle: () => void = () => undefined
  const parked = new Promise<void>((resolve) => {
    settle = resolve
  })
  const release = (): void => {
    if (parkedRelease === release) {
      parkedRelease = null
    }
    settle()
  }
  parkedRelease = release
  return { parked, release }
}

/** End whichever task is parked, if one is. Safe to call at any time. */
export function releaseBackgroundLinkTask(): void {
  parkedRelease?.()
}

/** Test-only: whether a task is currently parked. */
export function isBackgroundLinkTaskParked(): boolean {
  return parkedRelease !== null
}
