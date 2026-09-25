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
 *  Claude Code writes under `$CLAUDE_CONFIG_DIR/projects/` when that is set, so
 *  a profile such as `~/.claude-work` holds the same layout under another name.
 *  On 2026-09-25 (Claude Code 2.1.282, Orca 1.4.211) five of the seven Claude
 *  transcript paths Orca had saved on this machine were under `~/.claude-work`,
 *  and none of those panes could get a chat once their status lost its agent
 *  name. The directory can be called anything, so outside `.claude` the path
 *  has to be Claude's own: the project directory is the working directory with
 *  every character that is not a letter or digit turned into `-` (it starts with
 *  `-` for a POSIX path, `C--` for a Windows one), and the file is named for
 *  the session UUID. All 667 transcripts in both config dirs here have that
 *  shape; none of the 140 JSON Lines files Codex, Grok, Droid and Gemini wrote
 *  here does.
 *
 *  Anything else returns null. A path we do not recognise is not a reason to
 *  pick the likelier agent: a wrong identity opens the wrong transcript reader
 *  against a real session file.
 */

const CLAUDE_DEFAULT_HOME_TRANSCRIPT = /(?:^|\/)\.claude\/projects\/[^/]+\/[^/]+\.jsonl$/
/** `<config dir>/projects/<dashed working directory>/<session uuid>.jsonl`;
 *  the first group is the config dir's name. */
const CLAUDE_CONFIG_DIR_TRANSCRIPT =
  /(?:^|\/)([^/]+)\/projects\/(?:-|[A-Za-z]--)[A-Za-z0-9-]*\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/
const CODEX_ROLLOUT = /(?:^|\/)\.codex\/sessions\/(?:[^/]+\/)+[^/]+\.jsonl$/
/** Homes that hold Claude's layout for someone else. OpenClaude writes
 *  Claude-format transcripts under its own `~/.openclaude` (Orca's
 *  OPENCLAUDE_HOOK_SETTINGS), and a Codex home belongs to Codex. */
const NOT_CLAUDE_CONFIG_DIRS: ReadonlySet<string> = new Set(['.openclaude', '.codex'])

/** Windows hosts report the same layouts with backslashes. */
function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

function isClaudeTranscript(path: string): boolean {
  if (CLAUDE_DEFAULT_HOME_TRANSCRIPT.test(path)) {
    return true
  }
  const configDir = CLAUDE_CONFIG_DIR_TRANSCRIPT.exec(path)?.[1]
  return configDir !== undefined && !NOT_CLAUDE_CONFIG_DIRS.has(configDir.toLowerCase())
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
  const claude = isClaudeTranscript(path)
  const codex = CODEX_ROLLOUT.test(path)
  // A path both layouts fit says nothing about who wrote it.
  if (claude && codex) {
    return null
  }
  if (claude) {
    return 'claude'
  }
  return codex ? 'codex' : null
}
