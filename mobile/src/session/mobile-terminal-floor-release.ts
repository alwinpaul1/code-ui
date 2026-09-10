/**
 * Asking the host for phone dimensions is not a preference — it is the
 * presence-lock TAKE-FLOOR gesture. The desk's keyboard is paused and its TUI
 * reflows narrow until something hands the floor back, and only the phone can.
 *
 * Measured on a Galaxy S23 against a terminal printing its own `tput cols`
 * every second, app force-stopped first so nothing carried over:
 *
 *   chat view, clean start      COLS=120
 *   open the terminal tab       COLS=51   <- the phone takes the floor
 *   HOME, app backgrounded      COLS=51   <- never released
 *   +8s                         COLS=51
 *   return, switch to a chat tab COLS=51  <- never released
 *   +8s                         COLS=51
 *
 * The desk sat at 51 columns indefinitely. The release only ever fired on two
 * paths — switching to Chat UI, and the route unmounting — and backgrounding
 * does neither, while a tab switch nulls `activeHandle` before the effect that
 * would release it runs, so it bails on `!activeHandle`.
 *
 * Releasing is the direction that matters. Taking the floor again is cheap and
 * happens whenever the terminal is shown; failing to give it back leaves
 * someone else's keyboard paused, so a failed release is retried.
 */
export type FloorReleaseReason = 'left-terminal' | 'backgrounded' | 'route-closed'

/** Whether leaving this state owes the desk its floor back. Releasing a handle
 *  the phone never drove would narrow a terminal it does not own. */
export function shouldReleaseFloor(args: {
  drivenHandles: ReadonlySet<string>
  handle: string | null
}): boolean {
  return args.handle != null && args.drivenHandles.has(args.handle)
}

export const FLOOR_RELEASE_RETRY_DELAYS_MS: readonly number[] = [0, 250, 1000, 3000]

/**
 * Retries the hand-back until the host takes it. Unlike taking the floor this
 * cannot be left to the next gesture: nothing else will ask, and the cost of
 * giving up is a desk stuck narrow. `isReclaimed` abandons the moment the
 * reader is driving that terminal again, so a late release cannot pause a desk
 * whose floor the phone legitimately holds.
 */
export async function releaseFloorUntilAccepted(args: {
  release: () => Promise<boolean>
  wait: (ms: number) => Promise<void>
  isReclaimed: () => boolean
  delays?: readonly number[]
}): Promise<boolean> {
  for (const delayMs of args.delays ?? FLOOR_RELEASE_RETRY_DELAYS_MS) {
    if (args.isReclaimed()) {
      return false
    }
    if (delayMs > 0) {
      await args.wait(delayMs)
      if (args.isReclaimed()) {
        return false
      }
    }
    if (await args.release()) {
      return true
    }
  }
  return false
}
