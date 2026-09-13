const ESC = String.fromCharCode(0x1b)

/* oxlint-disable no-control-regex -- this matches terminal ESC sequences by definition */
/**
 * CSI sequences that move the cursor absolutely or erase part of the screen:
 * `H` and `f` (cursor position), `J` and `K` (erase in display/line), `r`
 * (scrolling region). A terminal EMITS these; nothing the phone sends as input
 * ever needs one.
 *
 * The phone's whole input vocabulary was checked against this (2026-09-13): the
 * key table is a bare ESC, `CSI Z`, `CSI 3 ~` and the four arrows; gestures are
 * X10 and SGR mouse reports, which end `M` or `m`; a paste is wrapped in
 * `CSI 200 ~` / `CSI 201 ~`; the input-line clear is Ctrl+U and Ctrl+K. None of
 * them match, and a phone keyboard cannot type a raw ESC byte into a prompt.
 */
const SCREEN_CONTROL_RE = new RegExp(`${ESC}\\[[0-9;?]*[HfJKr]`, 'g')
/* oxlint-enable no-control-regex */

/**
 * Removes screen-control sequences from bytes on their way to a PTY.
 *
 * Defence in depth behind the replay guard. A host snapshot ends with an
 * absolute cursor restore (`CSI <rows> ; 1 H`), and any path that let emulator
 * output turn back into input carried it to the agent, whose TUI drew it as
 * typed text — `54;1H` sat in the desktop Claude Code composer (2026-09-13).
 * The guard closes the one door that was found; this closes the shape.
 *
 * Strips rather than refuses: these bytes cannot be part of anything the user
 * meant, and dropping a whole send would lose a real message with it.
 */
export function stripTerminalScreenControl(text: string): string {
  return text.includes(ESC) ? text.replace(SCREEN_CONTROL_RE, '') : text
}
