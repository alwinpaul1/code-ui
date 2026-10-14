import { useCallback, useEffect, useRef } from 'react'

/** How long an open waits for its window and its first layout before it plays
 *  anyway. Both normally arrive within a frame or two of the commit that mounts
 *  the sheet; this only bounds a platform that never reports one, so no sheet
 *  can be left mounted and invisible. */
export const DRAWER_ENTER_FALLBACK_MS = 250

/**
 * Holds a freshly mounted sheet's open until there is something to animate:
 * its native window is up and its height is known.
 *
 * Why: the open used to start in the effect of the commit that mounted the
 * sheet. On Android that commit is also what builds the Modal's Dialog window
 * (on the UI thread, at mount) and only then reports the sheet's height to JS
 * (`onLayout`, a later JS task, behind whatever the keyboard leaving just
 * queued). The 180 ms curve ran on regardless: it spent its steep first frames
 * before the window drew anything, and it ran with the whole window height as
 * its travel, because a sheet that has never laid out has no height. When the
 * height did arrive the travel shrank by two thirds in one frame and the sheet
 * jumped up. The + sheet is mounted fresh on every tap, so every open took that
 * path: blank, then a snap into place (reported 2026-10-10, S23 Ultra).
 *
 * `request` asks for the open, `layoutMeasured` and `windowShown` report the two
 * signals, and the open plays once all three are in. A sheet that already has
 * both (a reopen while it was still closing, a close its parent refused) plays
 * at once.
 */
export function useDrawerEnterGate({
  windowAlreadyShown,
  enter
}: {
  /** True inside a BottomDrawerModalHost, which owns the window, so the sheet
   *  has no onShow of its own. For the host's first sheet that window is built
   *  in the same commit, and the gate then waits only for the layout. */
  windowAlreadyShown: boolean
  enter: () => void
}): {
  request: () => void
  cancel: () => void
  layoutMeasured: () => void
  windowShown: () => void
} {
  const enterRef = useRef(enter)
  enterRef.current = enter
  const stateRef = useRef({ pending: false, laidOut: false, shown: windowAlreadyShown })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const play = useCallback(() => {
    stateRef.current.pending = false
    clearTimer()
    enterRef.current()
  }, [clearTimer])

  const playIfReady = useCallback(() => {
    const state = stateRef.current
    if (state.pending && state.laidOut && state.shown) {
      play()
    }
  }, [play])

  const request = useCallback(() => {
    const state = stateRef.current
    if (state.laidOut && state.shown) {
      play()
      return
    }
    state.pending = true
    if (timerRef.current === null) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (stateRef.current.pending) {
          play()
        }
      }, DRAWER_ENTER_FALLBACK_MS)
    }
  }, [play])

  const cancel = useCallback(() => {
    stateRef.current.pending = false
    clearTimer()
  }, [clearTimer])

  const layoutMeasured = useCallback(() => {
    stateRef.current.laidOut = true
    playIfReady()
  }, [playIfReady])

  const windowShown = useCallback(() => {
    stateRef.current.shown = true
    playIfReady()
  }, [playIfReady])

  useEffect(() => clearTimer, [clearTimer])

  return { request, cancel, layoutMeasured, windowShown }
}
