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
 *  Codex does the same with `$CODEX_HOME/sessions/`, and Orca sets CODEX_HOME
 *  in every terminal it opens once it manages the Codex home (Orca main
 *  2026-09-23, ipc/pty/host-env/assembly.ts): `<userData>/codex-runtime-home/home`,
 *  or `<userData>/codex-accounts/<id>/home` for a managed account. A `codex`
 *  typed into such a terminal writes its rollout there, and this machine's
 *  runtime home holds one from 2026-09-05. Outside `.codex` the path has to be
 *  Codex's own: `sessions/YYYY/MM/DD/rollout-<start time>-<thread uuid>.jsonl`,
 *  the dated layout Orca's own `claimsCodexRolloutLayout` keys on. All 13
 *  rollouts on this machine have it (2026-09-25); none of the 668 Claude
 *  transcripts or the 1504 other JSON Lines files under the agents' homes do.
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
const CODEX_DEFAULT_HOME_ROLLOUT = /(?:^|\/)\.codex\/sessions\/(?:[^/]+\/)+[^/]+\.jsonl$/
/** `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<start time>-<thread uuid>.jsonl`. */
const CODEX_HOME_ROLLOUT =
  /(?:^|\/)[^/]+\/sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/
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
  const codex = CODEX_DEFAULT_HOME_ROLLOUT.test(path) || CODEX_HOME_ROLLOUT.test(path)
  // A path both layouts fit says nothing about who wrote it.
  if (claude && codex) {
    return null
  }
  if (claude) {
    return 'claude'
  }
  return codex ? 'codex' : null
}

const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:\/)/

/** The config dir a Claude session writes under (`CLAUDE_CONFIG_DIR`, or
 *  `~/.claude` when unset), in the host's own spelling: the transcript path
 *  minus `projects/<project>/<session>.jsonl`. Claude Code loads the user's
 *  skills, commands and plugins from that dir alone (2.1.282 and 2.1.283).
 *  Null for a path not named Claude above, and for a relative path. An
 *  absolute dir on another filesystem (a WSL guest's `/home/…`, an SSH
 *  target's) is returned as is; the host then fails to list it and the menu
 *  has no home skills, rather than the host's own profile, which that session
 *  does not load. */
export function claudeConfigDirFromTranscriptPath(transcriptPath: string | null | undefined): string | null {
  if (!transcriptPath || nativeChatAgentFromTranscriptPath(transcriptPath) !== 'claude') {
    return null
  }
  const posix = toPosix(transcriptPath)
  // Separators are swapped one for one, so an index into one spelling is an
  // index into the other.
  const configDir = posix.split('/').slice(0, -3).join('/')
  return ABSOLUTE_PATH.test(configDir) ? transcriptPath.slice(0, configDir.length) : null
}
