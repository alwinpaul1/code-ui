/**
 * Peer messages Claude Code has painted on its own screen.
 *
 * Why: a message from another session or a subagent reaches the transcript
 * mostly as records Orca's reader never publishes (of 58 on this machine, 35
 * were mid-turn `attachment` records and 20 `isMeta` rows; 3 reached the
 * phone). Claude does paint each landing as one row:
 *
 *     › Message from @probe (ctrl+o to expand)
 *
 * (tmux capture, Claude Code 2.1.278 at 46 columns, 2026-09-20; fixture
 * beside the test). The message is behind ctrl+o and never on screen, so
 * the row can only say WHO wrote, not what: the phone draws it as a one-line
 * notice at the point in the conversation it was first seen
 * (use-screen-peer-notices.ts), which is all it knows. A `⏺ Teammate @x
 * finished` row is the agent's completion, carried elsewhere, and is not read.
 */

/** The marker Claude paints for these rows is `›` (U+203A), not the `❯` of a
 *  prompt; the sent-prompt reader skips them by wording for the same reason. */
const PEER_ROW = /^› (?:Cross-session message|Message) from @(\S+) \(ctrl\+o to expand\)\s*$/

/** The senders of every peer-message row on screen, in order, one per row. */
export function peerNoticesFromScreen(screen: readonly string[]): string[] {
  const senders: string[] = []
  for (const row of screen) {
    const match = PEER_ROW.exec(row)
    if (match?.[1]) {
      senders.push(match[1])
    }
  }
  return senders
}
