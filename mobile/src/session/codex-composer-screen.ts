/** Codex's own input row: `›` at column 0, then a space (or nothing, once a
 *  reader trims it). A sent prompt, a popup's selected row and an approval's or
 *  picker's selected option wear the same glyph, so it is only the START of the
 *  proof. */
const COMPOSER_ROW = /^›(?: |$)/
/** The key hint under a picker or a dialog ("Press enter to confirm or esc to go
 *  back", "Press enter to confirm or esc to cancel", "enter continue · esc quit").
 *  Real Codex 0.153.4 and 0.158.0 wording. The composer's footer rows
 *  ("tab to queue message", "esc again to edit previous message", "ctrl + c
 *  again to quit", the model row) hold none of these pairs. */
const DIALOG_HINT = /^\s*(?:press\s+)?(?:enter|esc)\b.*\b(?:confirm|cancel|go back|continue|quit|select)\b/i

/**
 * Whether Codex's composer is up, as far as a screen can show: the last `›` row
 * at column 0, with nothing under it at column 0 and no dialog key hint under it
 * (an approval's, a picker's and the trust prompt's selected rows wear `›` too,
 * and each has its hint). The row may start with a number: the chat's own draft
 * answering by number is typed into the composer (the dialog check owns the
 * numbered-menu cases, mobile-native-chat-dialog-guard.ts). Rows under the composer are indented two
 * columns: the footer, a popup, a transient hint (a shell prompt is at column
 * 0, and so are Codex's own exit lines, `Token usage: ...`).
 *
 * Evidence: every captured Codex screen of a ready or working composer passes
 * (0.153.4: the bottom of a live S23 session; 0.155.1; 0.158.0; with and without
 * the blank rows Orca drops, fixtures/codex-composer-screens.ts), and the
 * approval, the trust prompt and the /model picker do not. The footer
 * (`  <model> <effort> · <cwd>`) is under the composer in all of them but is NOT
 * required: a slash or `@` popup (modelled: 0.153.4 draws it below the composer,
 * 0.158 above), a custom `tui.status_line` and a Windows directory would each
 * refuse a live composer for good, and the phone's own typing opens popups.
 *
 * `underneath` is for a follow onto a new terminal, which wants a row drawn
 * under the composer, as claudeLiveFrame does for Claude: a bare composer row is
 * not shown to be a whole frame (a restored terminal is seeded with an old one).
 *
 * NOT captured: what a shell shows after Codex exits. Its prompt and exit lines
 * are modelled at column 0 and refuse; an exit that leaves the old frame with
 * nothing drawn under it passes, and no screen can tell it from a live one.
 */
export function codexComposerLive(
  lines: readonly string[],
  options: { underneath?: boolean } = {}
): boolean {
  const composer = lines.findLastIndex((row) => COMPOSER_ROW.test(row))
  if (composer === -1) {
    return false
  }
  const below = lines.slice(composer + 1).filter((row) => row.trim() !== '')
  return (
    (!options.underneath || below.length > 0) &&
    below.every((row) => row.startsWith('  ') && !DIALOG_HINT.test(row))
  )
}
