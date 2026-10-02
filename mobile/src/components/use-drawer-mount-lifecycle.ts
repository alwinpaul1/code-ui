import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { resolveBottomDrawerMounted } from './bottom-drawer-mount-state'

/**
 * When a sheet is mounted, and the one action it owes after it has left: the
 * mount state shared by BottomDrawer and DraggableDetailSheet.
 *
 * `visible` mounts the sheet before the commit (so it can animate in on its
 * first frame); it stays mounted until the sheet's exit animation reports
 * through `handleHidden`, and `onAfterClose` runs once the unmount has
 * committed, which is when a hand-off to the next sheet may open it.
 *
 * Why the "already reported" flags reset on EVERY change of `visible`, not
 * only on opening: the exit animation finishes on the UI thread and reaches
 * `handleHidden` through runOnJS a task later. A sheet reopened in between has
 * the previous close's report still in flight. That report used to set the
 * flag after the reopen had cleared it, and nothing cleared it again, so the
 * NEXT close was dropped as a duplicate: the sheet stayed mounted at progress
 * 0, a full-screen Modal with nothing drawn that ate every tap, and the
 * `onAfterClose` a hand-off waits on never ran.
 */
export function useDrawerMountLifecycle(
  visible: boolean,
  onAfterClose: (() => void) | undefined
): { mounted: boolean; handleHidden: () => void } {
  const [mounted, setMounted] = useState(visible)
  const onAfterCloseRef = useRef(onAfterClose)
  const hiddenHandledRef = useRef(false)
  const afterClosePendingRef = useRef(false)

  useEffect(() => {
    onAfterCloseRef.current = onAfterClose
  }, [onAfterClose])

  // A layout effect, so it runs before the sheet's own passive effects: a sheet
  // that finds itself already off the screen reports `handleHidden` from one,
  // and this must not wipe that report.
  useLayoutEffect(() => {
    hiddenHandledRef.current = false
    afterClosePendingRef.current = false
  }, [visible])

  useEffect(() => {
    if (mounted || !afterClosePendingRef.current) {
      return
    }
    afterClosePendingRef.current = false
    onAfterCloseRef.current?.()
  }, [mounted])

  const handleHidden = useCallback(() => {
    if (hiddenHandledRef.current) {
      return
    }
    hiddenHandledRef.current = true
    afterClosePendingRef.current = true
    setMounted(false)
  }, [])

  const resolvedMounted = resolveBottomDrawerMounted(visible, mounted)
  // Why: opening drawers should mount before commit; waiting for a passive
  // Effect adds a null render before every drawer can animate in.
  if (resolvedMounted !== mounted) {
    setMounted(resolvedMounted)
  }
  return { mounted: resolvedMounted, handleHidden }
}
