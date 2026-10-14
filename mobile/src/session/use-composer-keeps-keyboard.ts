import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { anyTextFieldFocused } from './text-field-focus'
import { clearKeyboardRelease, keyboardReleased } from './keyboard-release'
import { useAppReturns } from './use-app-returns'
import { useNativeChatScreenFocus } from './use-native-chat-screen-focus'

/** How long after the composer comes on screen an open keyboard nobody owns is
 *  taken back for it. Long enough for an IME restored on resume to report its
 *  height; short enough that a keyboard raised later, by something the phone's
 *  JavaScript cannot see (a WebView's own field), is left alone. */
export const COMPOSER_KEYBOARD_CLAIM_MS = 1500

/** How long the keyboard must stay up, with no field focused, before it counts
 *  as orphaned. Android clears the keyboard's height only on keyboardDidHide,
 *  at the end of its hide animation, so for that long after a Keyboard.dismiss
 *  (a terminal send to an agent dismisses it, and the tab can flip to chat
 *  right after) the keyboard still reads as up. A keyboard that is leaving has
 *  reported its hide by then; an orphaned one stays. */
export const COMPOSER_KEYBOARD_SETTLE_MS = 500

/** After the settle, how often the claim looks again while its window is
 *  open. One look at the settle missed a keyboard that was not yet orphaned
 *  at that instant and became so a moment later: the terminal field the
 *  keyboard came from still read as focused, or the chat surface was still
 *  settling, on a new terminal tab that starts Claude (2026-10-14). */
export const COMPOSER_KEYBOARD_RETRY_MS = 250

/**
 * Never a keyboard up over a composer that does not hold focus.
 *
 * A field that loses focus natively leaves the Android keyboard up: its view
 * leaves the window under a pushed route, or moves to another native parent
 * (the draft fold did, until its collapsable={false}). React Native's blur of a
 * focused field that unmounts is meant to hide the keyboard
 * (ReactEditText.clearFocusAndMaybeRefocus), but the 2026-10-12 report, on a
 * new tab, is a keyboard left up with nothing focused: the box showed its
 * placeholder and no cursor, and keys went nowhere until a tap. A fresh field
 * mounted under such a keyboard is not focused. A new agent tab remounts the
 * composer when it blinks out of chat for longer than the overlay's hold
 * (new-tab-composer-keeps-focus.test.tsx). Which of these the user met was not
 * seen on a device.
 *
 * So whenever the composer comes on screen (its screen reports focus, on mount
 * or on a return, or the app comes back) it claims, once and within
 * COMPOSER_KEYBOARD_CLAIM_MS, a keyboard that stays up for
 * COMPOSER_KEYBOARD_SETTLE_MS with no text field focused. A field that holds
 * focus keeps it, a keyboard that is down or leaving is never raised, and a
 * composer mounted under a covered screen claims nothing until it is shown.
 */
export function useComposerKeepsKeyboard(
  input: RefObject<{ focus: () => void } | null>,
  keyboardUp: boolean
): void {
  const keyboardUpRef = useRef(keyboardUp)
  keyboardUpRef.current = keyboardUp
  // Unknown until the screen says: useFocusEffect reports focus on mount only
  // when the screen is on top, and nothing for one mounted under a pushed route.
  const screenFocusedRef = useRef(false)
  const claimUntilRef = useRef(0)
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const orphaned = useCallback(
    (): boolean => keyboardUpRef.current && screenFocusedRef.current && !anyTextFieldFocused(),
    []
  )
  const claim = useCallback(() => {
    if (
      Date.now() > claimUntilRef.current ||
      !keyboardUpRef.current ||
      !screenFocusedRef.current ||
      settleRef.current !== null
    ) {
      return
    }
    const look = (): void => {
      settleRef.current = null
      if (!keyboardUpRef.current || !screenFocusedRef.current || keyboardReleased()) {
        // Down, covered, or put away on purpose: nothing to keep.
        return
      }
      if (orphaned() && input.current) {
        claimUntilRef.current = 0
        // The one line this leaves behind: a keyboard nobody held, and the
        // composer taking it. If keys still go nowhere after it, native dropped
        // the focus.
        console.warn('[composer] claimed an open keyboard no field held')
        input.current.focus()
        return
      }
      if (Date.now() <= claimUntilRef.current) {
        settleRef.current = setTimeout(look, COMPOSER_KEYBOARD_RETRY_MS)
      }
    }
    settleRef.current = setTimeout(look, COMPOSER_KEYBOARD_SETTLE_MS)
  }, [input, orphaned])
  const arm = useCallback(() => {
    claimUntilRef.current = Date.now() + COMPOSER_KEYBOARD_CLAIM_MS
    claim()
  }, [claim])

  useEffect(
    () => () => {
      if (settleRef.current !== null) {
        clearTimeout(settleRef.current)
      }
    },
    []
  )
  // The keyboard reports its height after the event that armed the claim.
  useEffect(() => {
    if (keyboardUp) {
      claim()
    } else {
      clearKeyboardRelease()
    }
  }, [claim, keyboardUp])
  useNativeChatScreenFocus(
    useCallback(
      (focused: boolean) => {
        const shown = focused && !screenFocusedRef.current
        screenFocusedRef.current = focused
        if (shown) {
          arm()
        }
      },
      [arm]
    )
  )
  useAppReturns(arm)
}
