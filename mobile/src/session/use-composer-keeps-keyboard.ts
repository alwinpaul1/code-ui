import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { anyTextFieldFocused } from './text-field-focus'
import { useAppReturns } from './use-app-returns'
import { useNativeChatScreenFocus } from './use-native-chat-screen-focus'

/** How long after the composer comes on screen an open keyboard nobody owns is
 *  taken back for it. Long enough for an IME restored on resume to report its
 *  height; short enough that a keyboard raised later, by something the phone's
 *  JavaScript cannot see (a WebView's own field), is left alone. */
export const COMPOSER_KEYBOARD_CLAIM_MS = 1500

/**
 * Never a keyboard up over a composer that does not hold focus.
 *
 * React Native hides the Android keyboard when a field is blurred from
 * JavaScript (ReactEditText.clearFocusAndMaybeRefocus). A field that loses focus natively (its
 * view leaves the window under a pushed route; a move to another native
 * parent did it too, which the draft fold's collapsable={false} now prevents)
 * leaves the keyboard up, and a fresh
 * field mounted under an open keyboard is not focused: a composer remounted
 * after the overlay yielded, or one the view toggle brings in while the
 * terminal's field was typing. The keyboard then types into nothing: the box
 * shows its placeholder and no cursor, and keys go nowhere until the user taps
 * it (reported 2026-10-12 on 0.9.130, a day after the new-tab case in
 * new-tab-composer-keeps-typed-keys.test.tsx). Which of these the user met was
 * not seen on the device.
 *
 * So whenever the composer comes on screen (it mounts, its route is on top
 * again, the app comes back) it claims a keyboard that is up while no text
 * field holds focus, once, within COMPOSER_KEYBOARD_CLAIM_MS. A field that
 * holds focus keeps it, and a keyboard that is down is never raised.
 */
export function useComposerKeepsKeyboard(
  input: RefObject<{ focus: () => void } | null>,
  keyboardUp: boolean
): void {
  const keyboardUpRef = useRef(keyboardUp)
  keyboardUpRef.current = keyboardUp
  const screenFocusedRef = useRef(true)
  const claimUntilRef = useRef(0)

  const claim = useCallback(() => {
    if (!keyboardUpRef.current || !screenFocusedRef.current) {
      return
    }
    if (Date.now() > claimUntilRef.current || anyTextFieldFocused()) {
      return
    }
    claimUntilRef.current = 0
    input.current?.focus()
  }, [input])
  const arm = useCallback(() => {
    claimUntilRef.current = Date.now() + COMPOSER_KEYBOARD_CLAIM_MS
    claim()
  }, [claim])

  // A layout effect, so the field is focused in the commit that mounts it: the
  // field it replaced was blurred in that same commit, and the keyboard stays.
  useLayoutEffect(() => {
    arm()
  }, [arm])
  // The keyboard reports its height after the event that armed the claim.
  useEffect(() => {
    if (keyboardUp) {
      claim()
    }
  }, [claim, keyboardUp])
  useNativeChatScreenFocus(
    useCallback(
      (focused: boolean) => {
        const returned = focused && !screenFocusedRef.current
        screenFocusedRef.current = focused
        // Only a return: the report that comes with the mount is the mount's own
        // claim, and arming again would reopen a claim already spent.
        if (returned) {
          arm()
        }
      },
      [arm]
    )
  )
  useAppReturns(arm)
}
