/**
 * The app put the soft keyboard away on purpose.
 *
 * Two fields claim a keyboard that no field holds: the chat composer
 * (use-composer-keeps-keyboard.ts) and the terminal dock's field
 * (use-terminal-live-input-focus.ts). Neither may bring back a keyboard the
 * app is dismissing. Android reports the keyboard gone only on keyboardDidHide,
 * at the end of its hide animation and sometimes later than a claim's settle,
 * and a Keyboard.dismiss() with no field focused may hide nothing at all. So a
 * dismissal says so here first, for every claimer at once: a terminal send to
 * an agent dismisses the keyboard and the tab can flip to chat in the same
 * moment, and then it is the composer that must not raise it again.
 *
 * Module state on purpose: there is one keyboard. A claimer clears it when it
 * sees the keyboard go down, and it lapses on its own after
 * KEYBOARD_RELEASE_MS, so a release nobody saw end cannot block claims for
 * good. No react-native import, so the terminal hooks can read it under vitest.
 */
export const KEYBOARD_RELEASE_MS = 3000

let releasedAt = Number.NEGATIVE_INFINITY

export function releaseKeyboard(now: number = Date.now()): void {
  releasedAt = now
}

export function keyboardReleased(now: number = Date.now()): boolean {
  return now - releasedAt < KEYBOARD_RELEASE_MS
}

/** The keyboard went down: a release has done its work. */
export function clearKeyboardRelease(): void {
  releasedAt = Number.NEGATIVE_INFINITY
}
