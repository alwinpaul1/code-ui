import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a parent has, after the sheet asks it to close, to hide the sheet. */
const REFUSAL_GRACE_MS = 100

/**
 * How a bottom sheet asks its parent to close once its own exit animation (a
 * backdrop tap, Back, or a drag past the threshold) has run to its end.
 *
 * Two things hang on that moment:
 *
 * - `leftScreenRef` is true from then until the sheet opens again. The
 *   parent's `visible=false` that follows finds the sheet already off the
 *   screen, so the sheet reports itself hidden at once instead of running the
 *   same exit a second time under a Modal that takes every tap and holds
 *   `onAfterClose` back.
 * - A parent may refuse ("not while it is saving", "not while connecting").
 *   The sheet is then at progress 0 with `visible` still true: nothing drawn,
 *   and a full-screen overlay that still takes every tap. A sheet still
 *   `visible` a moment after it asked is restored through `restore`. The
 *   moment (not the next render) is for a parent that closes through a
 *   navigation, which hides the sheet a few frames late; restoring at once
 *   would flash it back in on the way out.
 */
export function useDrawerCloseRequest(args: {
  visible: boolean
  /** Must flip `visible` to false in the same update, or refuse on purpose: a
   *  sheet still `visible` REFUSAL_GRACE_MS after asking comes back. A parent
   *  that closes later (a navigation, an await) sees the sheet flash in again. */
  onClose: () => void
  /** The sheet's mount-state report; called if a close is requested for a sheet
   *  whose parent had already hidden it, so it still reaches hidden. */
  onHidden: () => void
  /** Puts a sheet that animated out back on screen. Read when a refusal is seen. */
  restore: () => void
}): { requestClose: () => void; leftScreenRef: { current: boolean } } {
  const { visible, onClose, onHidden, restore } = args
  // The latest onClose, behind one stable function, so the gestures built
  // around it survive a parent that passes a new arrow on every render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  const leftScreenRef = useRef(false)
  const visibleRef = useRef(visible)
  const onHiddenRef = useRef(onHidden)
  useEffect(() => {
    onHiddenRef.current = onHidden
  }, [onHidden])
  const [attempt, setAttempt] = useState(0)

  const requestClose = useCallback(() => {
    leftScreenRef.current = true
    onCloseRef.current()
    // Asked while the parent had already hidden it: no `visible` change is
    // coming to run the exit effect, so report hidden here.
    if (!visibleRef.current) {
      onHiddenRef.current()
    }
    setAttempt((count) => count + 1)
  }, [])

  const restoreRef = useRef(restore)
  useEffect(() => {
    restoreRef.current = restore
  })
  useEffect(() => {
    visibleRef.current = visible
    if (visible) {
      leftScreenRef.current = false
    }
  }, [visible])

  useEffect(() => {
    if (attempt === 0) {
      return
    }
    const timer = setTimeout(() => {
      if (visibleRef.current) {
        leftScreenRef.current = false
        restoreRef.current()
      }
    }, REFUSAL_GRACE_MS)
    return () => clearTimeout(timer)
  }, [attempt])

  return { requestClose, leftScreenRef }
}
