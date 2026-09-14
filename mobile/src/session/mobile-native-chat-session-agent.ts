/** Which agent wrote the transcript the host captured for a pane.
 *
 *  Why this exists: a tab's `agentStatus.agentType` is the DESKTOP's answer to
 *  "who owns this pane", and that answer is assembled from a precedence list
 *  whose first four entries are all launch records. An agent the desktop did
 *  not launch — someone typed `claude` into a terminal the phone opened — has
 *  none of them, so its whole identity rests on the hook lane.
 *
 *  That lane expires and the session beside it does not. Read out of the
 *  shipped desktop (Orca 1.4.188, `out/main/index.js`): the pane snapshot takes
 *  `agentType` only from a hook row received within the last thirty minutes,
 *  while `providerSession` is taken from the newest row with no freshness bound
 *  at all. A hand-started agent that has been sitting idle longer than that
 *  publishes a tab carrying a real session id and a real transcript path with
 *  no agent name attached. The phone refused it, so the header offered no
 *  "Show chat" — the agent was right there and there was no way into it.
 *
 *  The transcript path is better evidence than the name anyway: the agent wrote
 *  it, nobody else writes that layout, and it arrives already paired with the
 *  session id chat needs. This is the agent telling us who it is, not us
 *  guessing from a tab title.
 *
 *  Layouts verified on macOS 2026-09-14 against real files:
 *    Claude Code 2.1.270
 *      /Users/me/.claude/projects/-Users-me-Desktop-Project/<uuid>.jsonl
 *    Codex 0.153
 *      /Users/me/.codex/sessions/2026/09/11/rollout-2026-09-11T02-42-13-<id>.jsonl
 *
 *  Anything else returns null. A path we do not recognise is not a reason to
 *  pick the likelier agent: a wrong identity opens the wrong transcript reader
 *  against a real session file.
 */

/** Windows hosts report the same layouts with backslashes. */
function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

export function nativeChatAgentFromTranscriptPath(
  transcriptPath: string | null | undefined
): 'claude' | 'codex' | null {
  if (!transcriptPath) {
    return null
  }
  const path = toPosix(transcriptPath)
  // Both agents write JSON Lines. Requiring the extension keeps a directory or
  // a truncated path from matching on its prefix alone.
  if (!path.endsWith('.jsonl')) {
    return null
  }
  if (/(?:^|\/)\.claude\/projects\/[^/]+\/[^/]+\.jsonl$/.test(path)) {
    return 'claude'
  }
  if (/(?:^|\/)\.codex\/sessions\/(?:[^/]+\/)+[^/]+\.jsonl$/.test(path)) {
    return 'codex'
  }
  return null
}
