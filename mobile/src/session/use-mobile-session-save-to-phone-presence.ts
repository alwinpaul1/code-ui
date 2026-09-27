import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFocusEffect } from 'expo-router'

/** What a tab-menu save answers to (mobile-session-save-to-phone-action.ts). */
export type SaveToPhonePresence = {
  /** Aborted once the user leaves the session: the save's read stops and its picker never opens. */
  signal: () => AbortSignal
  /** Whether the session is the screen in front right now. */
  onScreen: () => boolean
}

/**
 * Whether the user is still in this session, for Save to Phone from a tab's own menu.
 *
 * That save has no screen of its own: the menu closes the moment it is pressed, and the tab may
 * close or change while the file pages over. So it answers to the session. Covered by another
 * screen (the file browser, Settings), the session keeps the save running but the save will not
 * open Android's picker over that screen, since its toast would show nowhere. Left altogether (the
 * session screen unmounts), the save is aborted.
 */
export function useMobileSessionSaveToPhonePresence(): { saveToPhonePresence: SaveToPhonePresence } {
  const focusedRef = useRef(false)
  const lifetimeRef = useRef<AbortController | null>(null)
  const leftRef = useRef(false)

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true
      return () => {
        focusedRef.current = false
      }
    }, [])
  )

  useEffect(() => {
    leftRef.current = false
    return () => {
      leftRef.current = true
      lifetimeRef.current?.abort()
      lifetimeRef.current = null
    }
  }, [])

  const saveToPhonePresence = useMemo<SaveToPhonePresence>(
    () => ({
      signal: () => {
        if (leftRef.current) {
          const gone = new AbortController()
          gone.abort()
          return gone.signal
        }
        lifetimeRef.current ??= new AbortController()
        return lifetimeRef.current.signal
      },
      onScreen: () => focusedRef.current && !leftRef.current
    }),
    []
  )
  return { saveToPhonePresence }
}
