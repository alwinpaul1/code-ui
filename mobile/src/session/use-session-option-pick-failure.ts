// What the session-option drawer says about its last pick, and where that goes
// when the drawer cannot show it. See session-option-pick-failure.ts for why
// the drawer says it at all.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PickFailureReport } from './session-option-pick-failure'

/** How long the drawer has to have drawn a failure before the user is taken to
 *  have read it. One the drawer stops showing sooner goes to the chat's banner.
 *  Back, a backdrop tap and a swipe close the drawer only after its 150 to
 *  300 ms hide animation (mounted-bottom-drawer.tsx), so a failure can land in
 *  a drawer that is already on its way out; a second covers that window and a
 *  slow JS thread on top of it. */
const READ_MS = 1_000

// Monotonic, so a wall-clock correction cannot make a read failure look new.
let clock: () => number = () => performance.now()

/** Test-only: the clock the drawer times its failures on, or null for the real one. */
export function setSessionOptionPickFailureClockForTests(next: (() => number) | null): void {
  clock = next ?? (() => performance.now())
}

/** A pick's failure, and the chat reporter of the tab the pick was made on. */
type PickFailure = { message: string; report: PickFailureReport }

export function useSessionOptionPickFailure(args: {
  drawerOpen: boolean
  /** The current tab's banner-or-toast reporter. It is new for each tab, and
   *  that is how a pick made on another tab is told apart. */
  reportFailure: PickFailureReport
}): {
  /** The message to draw in the drawer, or null. */
  shown: string | null
  /** A reporter for one pick, bound to the tab it is made on. */
  reporterForPick: () => PickFailureReport
  /** Drop the failure: a new pick, or another view of the drawer. */
  clear: () => void
} {
  const { drawerOpen, reportFailure } = args
  const [failure, setFailureState] = useState<PickFailure | null>(null)
  // The same value, for the unmount below, which runs after the last render.
  const latestRef = useRef<PickFailure | null>(null)
  // When the drawer first drew the failure. A failure it never drew is unread
  // however long ago it was said.
  const drawnRef = useRef<{ failure: PickFailure; at: number } | null>(null)
  const mountedRef = useRef(false)
  const setFailure = useCallback((next: PickFailure | null) => {
    latestRef.current = next
    setFailureState(next)
  }, [])
  const read = (candidate: PickFailure): boolean => {
    const drawn = drawnRef.current
    return drawn !== null && drawn.failure === candidate && clock() - drawn.at >= READ_MS
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Said in the same render that unmounted the drawer (an agent-picker pick
      // that flips the tab to its terminal), or just before: nothing is left to
      // show it.
      const pending = latestRef.current
      latestRef.current = null
      if (pending && !read(pending)) {
        pending.report(pending.message)
      }
    }
  }, [])

  const ownTab = failure !== null && failure.report === reportFailure
  const shown = drawerOpen && ownTab ? failure.message : null
  useLayoutEffect(() => {
    if (shown !== null && failure !== null && drawnRef.current?.failure !== failure) {
      drawnRef.current = { failure, at: clock() }
    }
  }, [failure, shown])

  // The drawer stops showing a failure when it closes (the X, Back, a backdrop
  // tap, a swipe, or the pick that said it), or when the chat moves to another
  // tab. One the user has read goes no further. One they have not goes to its
  // own tab's reporter, which paints that tab's banner, or the toast once the
  // tab is gone.
  useEffect(() => {
    if (failure !== null && (!drawerOpen || failure.report !== reportFailure)) {
      setFailure(null)
      if (!read(failure)) {
        failure.report(failure.message)
      }
    }
  }, [drawerOpen, failure, reportFailure, setFailure])

  return {
    shown,
    reporterForPick: () => {
      const report = reportFailure
      return (message) => {
        if (mountedRef.current) {
          setFailure({ message, report })
        } else {
          report(message)
        }
      }
    },
    clear: () => setFailure(null)
  }
}
