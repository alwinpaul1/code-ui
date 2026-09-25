// What the session-option drawer says about its last pick, and where that goes
// when the drawer cannot show it. See session-option-pick-failure.ts for why
// the drawer says it at all.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PickFailureReport } from './session-option-pick-failure'

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
  /** Drop the failure: the user had it in front of them and moved on. */
  clear: () => void
} {
  const { drawerOpen, reportFailure } = args
  const [failure, setFailureState] = useState<PickFailure | null>(null)
  // The same value, for the unmount below, which runs after the last render.
  const latestRef = useRef<PickFailure | null>(null)
  const mountedRef = useRef(false)
  const setFailure = useCallback((next: PickFailure | null) => {
    latestRef.current = next
    setFailureState(next)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Said in the same render that unmounted the drawer (an agent-picker pick
      // that flips the tab to its terminal): nothing is left to show it.
      const pending = latestRef.current
      latestRef.current = null
      pending?.report(pending.message)
    }
  }, [])

  // A failure the drawer is not showing goes to its own tab's reporter: the
  // drawer closed first (Back, a backdrop tap and a swipe close it only after
  // the hide animation, and a failure can land in that window), the pick that
  // said it closed the drawer, or the chat has moved to another tab since. That
  // reporter paints its own tab's banner, or the toast once the tab is gone.
  const ownTab = failure !== null && failure.report === reportFailure
  useEffect(() => {
    if (failure !== null && (!drawerOpen || failure.report !== reportFailure)) {
      setFailure(null)
      failure.report(failure.message)
    }
  }, [drawerOpen, failure, reportFailure, setFailure])

  return {
    shown: drawerOpen && ownTab ? failure.message : null,
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
