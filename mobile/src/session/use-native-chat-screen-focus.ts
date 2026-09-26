import { useCallback } from 'react'
import { useFocusEffect } from 'expo-router'

/**
 * Tells `onFocusChange` when the session screen that holds the chat gains
 * navigation focus (true) and loses it (false), so the running rows stop
 * sweeping while a pushed route such as Settings covers the screen (code review
 * of c03f5328). The chat only mounts under the session route, whose own hooks
 * read focus the same way (use-mobile-session-preference-focus.ts).
 *
 * vitest.setup.ts stubs this for every test: expo-router has no Node entry,
 * and a list that hears no report keeps sweeping, which is the fail-open
 * answer. use-native-chat-screen-focus.test.ts runs it for real.
 */
export function useNativeChatScreenFocus(onFocusChange: (focused: boolean) => void): void {
  useFocusEffect(
    useCallback(() => {
      onFocusChange(true)
      return () => onFocusChange(false)
    }, [onFocusChange])
  )
}
