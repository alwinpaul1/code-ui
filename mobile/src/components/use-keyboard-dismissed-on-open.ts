import { useLayoutEffect } from 'react'
import { Keyboard } from 'react-native'

/** Sends the keyboard away in the commit that opens a sheet or modal with
 *  nothing to type.
 *
 *  A native Modal is a Dialog window laid out below the keyboard's window.
 *  Nothing else asks the keyboard to go: it leaves only once the Dialog has
 *  taken focus, and until then the sheet stands at rest under it. On the S23
 *  Ultra (2026-09-27) the chat composer's keyboard started to leave 128 ms
 *  after the tap and uncovered the + sheet at 286 ms. Asked here, the blur is
 *  a view command, and Fabric runs view commands before the mount that builds
 *  the Dialog, so the keyboard is already leaving as the window appears.
 *
 *  Only for surfaces with no text field of their own: this runs after their
 *  children mount, so it would blur a field they had just focused. */
export function useKeyboardDismissedOnOpen(open: boolean): void {
  useLayoutEffect(() => {
    if (open) {
      Keyboard.dismiss()
    }
  }, [open])
}
