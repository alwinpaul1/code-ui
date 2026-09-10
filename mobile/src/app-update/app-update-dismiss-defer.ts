/**
 * Close the update dialog after the press that asked for it has finished.
 *
 * Why not close it directly: the dialog is a Modal, which on Android is its
 * own window. Tearing that window down inside the press handler leaves the
 * system delivering the rest of the gesture with nowhere to send it, so it
 * goes to the window behind. Reproduced on a Galaxy S23 on 2026-09-10 and
 * recorded: an instant tap is fine, a press held for 400 ms lights up the
 * repository row sitting under the finger on the About screen.
 *
 * One frame is enough for the gesture to complete inside the dialog's own
 * window. The timer is the fallback for a platform with no frame callback,
 * and whichever runs first wins.
 */
export function deferDialogDismiss(close: () => void): void {
  let closed = false
  const runOnce = (): void => {
    if (closed) {
      return
    }
    closed = true
    close()
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(runOnce)
  }
  setTimeout(runOnce, 0)
}
