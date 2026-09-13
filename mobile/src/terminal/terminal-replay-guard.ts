/**
 * Keeps an emulator's own answers from travelling back to the PTY while it is
 * being fed a replay.
 *
 * A host snapshot is not live output: it ends with an absolute cursor restore
 * (`CSI <rows> ; 1 H` on a bottom-parked cursor) and carries whatever queries
 * the agent had painted when the frame was captured. Feeding that to an emulator
 * which answers queries turns those answers into input, and the agent's TUI
 * shows them as typed text — `54;1H` sat in the desktop Claude Code composer
 * after the phone relaunched on a 54-row tab (2026-09-13).
 *
 * The WebView engine already gates its replies on a replay boundary and the host
 * scopes them to the chunk that carried the query. Ghostty had neither, so a
 * snapshot write and a keystroke were indistinguishable at the moment bytes left.
 *
 * Nested because a resize or a second snapshot can start while one is still in
 * flight; input resumes only once the last of them has drained.
 */
export type TerminalReplayGuard = {
  /** Whether bytes coming up from the emulator right now answer a replay. */
  readonly suppressed: () => boolean
  /** Runs `write` with replies suppressed, whatever it does. */
  readonly replay: (write: () => Promise<unknown> | unknown) => Promise<void>
}

export function createTerminalReplayGuard(): TerminalReplayGuard {
  let depth = 0
  return {
    suppressed: () => depth > 0,
    replay: async (write) => {
      depth += 1
      try {
        await write()
      } finally {
        depth -= 1
      }
    }
  }
}
