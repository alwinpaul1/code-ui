// What the session-option drawer says about its last pick, and where that goes
// when the drawer cannot show it. See session-option-pick-failure.ts for why
// the drawer says it at all.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PickFailureReport } from './session-option-pick-failure'

/** How long a failure has to have been in the open drawer before the user is
 *  taken to have read it. One the drawer stops showing sooner goes to the
 *  chat's banner. Back, a backdrop tap and a swipe close the drawer only after
 *  its 150 to 300 ms hide animation (mounted-bottom-drawer.tsx), so a failure
 *  can land in a drawer that is already on its way out; a second covers that
 *  window and a slow JS thread on top of it. */
const READ_MS = 1_000

/** A pick's failure, the chat reporter of the tab the pick was made on, and
 *  when the drawer took it. */
type PickFailure = { message: string; report: PickFailureReport; at: number }

function unread(failure: PickFailure): boolean {
  return Date.now() - failure.at < READ_MS
}

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
      // that flips the tab to its terminal), or just before: nothing is left to
      // show it.
      const pending = latestRef.current
      latestRef.current = null
      if (pending && unread(pending)) {
        pending.report(pending.message)
      }
    }
  }, [])

  // The drawer stops showing a failure when it closes (the X, Back, a backdrop
  // tap, a swipe, or the pick that said it), or when the chat moves to another
  // tab. One the user has read goes no further. One they have not goes to its
  // own tab's reporter, which paints that tab's banner, or the toast once the
  // tab is gone.
  const ownTab = failure !== null && failure.report === reportFailure
  useEffect(() => {
    if (failure !== null && (!drawerOpen || failure.report !== reportFailure)) {
      setFailure(null)
      if (unread(failure)) {
        failure.report(failure.message)
      }
    }
  }, [drawerOpen, failure, reportFailure, setFailure])

  return {
    shown: drawerOpen && ownTab ? failure.message : null,
    reporterForPick: () => {
      const report = reportFailure
      return (message) => {
        if (mountedRef.current) {
          setFailure({ message, report, at: Date.now() })
        } else {
          report(message)
        }
      }
    },
    clear: () => setFailure(null)
  }
}
