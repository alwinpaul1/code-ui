import { useEffect, useState } from 'react'
/**
 * Blocks touches on the screen under the update dialog while it closes.
 *
 * Why: the dialog is a Modal, which on Android is its own window. When that
 * window goes, the system hands what is left of the gesture to the window
 * behind, and whatever sits under the finger flashes its pressed state.
 * Reproduced and recorded on a Galaxy S23: holding Done for 400 ms lights up
 * the repository row on the About screen. Closing a frame later did not help,
 * because the window still disappears with the finger down.
 *
 * So the screen behind stops accepting touches while the dialog is up, and for
 * a short tail afterwards. The tail only has to outlast one stray release.
 */
export const APP_UPDATE_TOUCH_SHIELD_TAIL_MS = 250

export type TouchShieldState = {
  shielded: boolean
  /** When the dialog was last seen closed, for measuring the tail. */
  hiddenAt?: number | null
}

export function nextTouchShieldState(input: {
  shielded: boolean
  dialogVisible: boolean
  now: number
  hiddenAt?: number | null
}): { shielded: boolean; hiddenAt: number | null } {
  if (input.dialogVisible) {
    return { shielded: true, hiddenAt: null }
  }
  if (!input.shielded) {
    return { shielded: false, hiddenAt: null }
  }
  const since = input.hiddenAt ?? input.now
  return since + APP_UPDATE_TOUCH_SHIELD_TAIL_MS >= input.now
    ? { shielded: true, hiddenAt: since }
    : { shielded: false, hiddenAt: null }
}

/** React binding: true while the screen behind must refuse touches. */
export function useAppUpdateTouchShield(dialogVisible: boolean): boolean {
  const [state, setState] = useState<{ shielded: boolean; hiddenAt: number | null }>({
    shielded: dialogVisible,
    hiddenAt: null
  })
  useEffect(() => {
    setState((current) =>
      nextTouchShieldState({ ...current, dialogVisible, now: Date.now() })
    )
    if (dialogVisible) {
      return
    }
    const timer = setTimeout(
      () =>
        setState((current) =>
          nextTouchShieldState({
            ...current,
            dialogVisible: false,
            now: Date.now() + APP_UPDATE_TOUCH_SHIELD_TAIL_MS + 1
          })
        ),
      APP_UPDATE_TOUCH_SHIELD_TAIL_MS + 16
    )
    return () => clearTimeout(timer)
  }, [dialogVisible])
  return state.shielded
}
