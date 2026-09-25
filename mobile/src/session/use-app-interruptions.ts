import { useEffect } from 'react'
import { AppState } from 'react-native'

/**
 * Calls `onInterrupt` when the app leaves the foreground or its window loses
 * focus (Android's AppState `blur`: a call, a dialog, the shade).
 *
 * Those are the moments the system takes a touch away mid-gesture. Once the
 * chat's scroll view has taken a drag, Android sends JS no touch event for
 * the rest of it, and sends no end-drag when the system cancels it, so
 * nothing else says the finger is gone (use-mobile-chat-following.ts).
 * `onInterrupt` should be stable; it is subscribed once per identity.
 */
export function useAppInterruptions(onInterrupt: () => void): void {
  useEffect(() => {
    const change = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        onInterrupt()
      }
    })
    const blur = AppState.addEventListener('blur', () => onInterrupt())
    return () => {
      change.remove()
      blur.remove()
    }
  }, [onInterrupt])
}
