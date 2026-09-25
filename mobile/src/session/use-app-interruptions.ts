import { useEffect } from 'react'
import { AppState } from 'react-native'

/** `background`: the app left the foreground; every touch on it is over.
 *  `blur`: its window lost focus (Android: a call, a dialog, the shade); a
 *  touch JS still owns carries on, and JS will see it end. */
export type AppInterruption = 'background' | 'blur'

/**
 * Calls `onInterrupt` when the app leaves the foreground or its window loses
 * focus.
 *
 * Those are the moments the system takes a touch away mid-gesture. Once the
 * chat's scroll view has taken a drag, Android sends JS no touch event for
 * the rest of it, and sends no end-drag when the system cancels it, so
 * nothing else says the finger is gone (use-mobile-chat-following.ts).
 * `onInterrupt` should be stable; it is subscribed once per identity.
 */
export function useAppInterruptions(onInterrupt: (kind: AppInterruption) => void): void {
  useEffect(() => {
    const change = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        onInterrupt('background')
      }
    })
    const blur = AppState.addEventListener('blur', () => onInterrupt('blur'))
    return () => {
      change.remove()
      blur.remove()
    }
  }, [onInterrupt])
}
