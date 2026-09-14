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

export const FLOOR_CLAIM_RETRY_DELAYS_MS: readonly number[] = [0, 250, 1000, 3000]

/**
 * Retries the take-floor until the host accepts it.
 *
 * The comment above says taking the floor is cheap because "it happens whenever
 * the terminal is shown" — but a REFUSED request is not retried by that, and
 * nothing else asks either: the effect that pairs view with width fires only
 * when the view CHANGES, so one refusal left the terminal at desktop width for
 * as long as the user stayed on it. That is "all terminals open in desktop
 * mode, not mobile" (reported 2026-09-14). The refusal is real — the host can
 * reject a request that arrives before the pane has been measured, or while
 * another actor holds the floor.
 *
 * `isAbandoned` stops the moment the terminal is no longer the visible view, so
 * a late claim cannot narrow a desk the user has already left.
 */
export async function claimFloorUntilAccepted(args: {
  claim: () => Promise<boolean>
  wait: (ms: number) => Promise<void>
  isAbandoned: () => boolean
  delays?: readonly number[]
}): Promise<boolean> {
  for (const delayMs of args.delays ?? FLOOR_CLAIM_RETRY_DELAYS_MS) {
    if (args.isAbandoned()) {
      return false
    }
    if (delayMs > 0) {
      await args.wait(delayMs)
      if (args.isAbandoned()) {
        return false
      }
    }
    if (await args.claim()) {
      return true
    }
  }
  return false
}
