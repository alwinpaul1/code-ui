// What a chat sheet says about the last thing it was asked to do, and where
// that goes when the sheet cannot show it. A BottomDrawer draws in its own
// native window (mounted-bottom-drawer.tsx) and the chat's banner and toast
// draw in the screen under it, so a reason said only there while the sheet is
// open is never seen (2026-09-25). The session-option drawer (a pick) and the
// Background tasks sheet (a Stop) both say theirs through this.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Where one action's failure is said. */
export type SheetFailureReport = (message: string) => void

/** How long the sheet has to have drawn a failure before the user is taken to
 *  have read it. One the sheet stops showing sooner goes to the chat's banner.
 *  Back, a backdrop tap and a swipe close a sheet only after its 150 to 300 ms
 *  hide animation (mounted-bottom-drawer.tsx), so a failure can land in a
 *  sheet that is already on its way out; a second covers that window and a
 *  slow JS thread on top of it. */
const READ_MS = 1_000

// Monotonic, so a wall-clock correction cannot make a read failure look new.
let clock: () => number = () => performance.now()

/** Test-only: the clock sheets time their failures on, or null for the real one. */
export function setSheetFailureClockForTests(next: (() => number) | null): void {
  clock = next ?? (() => performance.now())
}

/** An action's failure, the tab it was made on, and that tab's reporter. */
type SheetFailure = { message: string; scope: string | null; report: SheetFailureReport }

export function useSheetFailure(args: {
  open: boolean
  /** The tab the chat shows (mobileNativeChatScopeKey). A failure is drawn only
   *  on the tab its action was made on, however the reporter below was built. */
  scopeKey: string | null
  /** The current tab's banner-or-toast reporter. */
  reportFailure: SheetFailureReport
}): {
  /** The message to draw in the sheet, or null. */
  shown: string | null
  /** A reporter for one action, bound to the tab it is made on. */
  reporter: () => SheetFailureReport
  /** Drop the failure: a new action, or another view of the sheet. */
  clear: () => void
} {
  const { open, scopeKey, reportFailure } = args
  const [failure, setFailureState] = useState<SheetFailure | null>(null)
  // The same value, for the unmount below, which runs after the last render.
  const latestRef = useRef<SheetFailure | null>(null)
  // When the sheet first drew the failure. A failure it never drew is unread
  // however long ago it was said.
  const drawnRef = useRef<{ failure: SheetFailure; at: number } | null>(null)
  const mountedRef = useRef(false)
  const setFailure = useCallback((next: SheetFailure | null) => {
    latestRef.current = next
    setFailureState(next)
  }, [])
  const read = (candidate: SheetFailure): boolean => {
    const drawn = drawnRef.current
    return drawn !== null && drawn.failure === candidate && clock() - drawn.at >= READ_MS
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Said in the same render that unmounted the sheet (an agent-picker pick
      // that flips the tab to its terminal), or just before: nothing is left to
      // show it.
      const pending = latestRef.current
      latestRef.current = null
      if (pending && !read(pending)) {
        pending.report(pending.message)
      }
    }
  }, [])

  const ownTab = failure !== null && failure.scope === scopeKey
  const shown = open && ownTab ? failure.message : null
  useLayoutEffect(() => {
    if (shown !== null && failure !== null && drawnRef.current?.failure !== failure) {
      drawnRef.current = { failure, at: clock() }
    }
  }, [failure, shown])

  // The sheet stops showing a failure when it closes (the X, Back, a backdrop
  // tap, a swipe, or the action that said it), or when the chat moves to
  // another tab. One the user has read goes no further. One they have not goes
  // to its own tab's reporter, which paints that tab's banner, or the toast
  // once the tab is gone.
  useEffect(() => {
    if (failure !== null && (!open || failure.scope !== scopeKey)) {
      setFailure(null)
      if (!read(failure)) {
        failure.report(failure.message)
      }
    }
  }, [open, failure, scopeKey, setFailure])

  return {
    shown,
    reporter: () => {
      const report = reportFailure
      const scope = scopeKey
      return (message) => {
        if (mountedRef.current) {
          setFailure({ message, scope, report })
        } else {
          report(message)
        }
      }
    },
    clear: () => setFailure(null)
  }
}
