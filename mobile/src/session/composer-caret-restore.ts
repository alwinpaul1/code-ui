/** How long after the slash menu opens or closes the field is still being
 *  moved. Android drops the caret onto the button under the field in that
 *  window, while the keyboard stays up. */
export const COMPOSER_MENU_LAYOUT_MS = 400

/** The delayed put-back. A keyboard that has already closed means the user
 *  left the field; restoring then would pop it open again. */
export function shouldRestoreComposerCaret(args: {
  typing: boolean
  keyboardVisible: boolean
  menuOpen: boolean
  sinceMenuChangeMs: number
}): boolean {
  if (!args.typing || !args.keyboardVisible) {
    return false
  }
  // Only the moment the menu opens or closes. A later blur, with the menu
  // still up, is the user leaving the field. Restoring then brings the
  // keyboard back after Back.
  return args.sinceMenuChangeMs < COMPOSER_MENU_LAYOUT_MS
}
