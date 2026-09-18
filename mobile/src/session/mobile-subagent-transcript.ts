// ─── Where a Claude subagent's transcript lives, and how to ask the host for it ─
//
// Claude Code writes each subagent (Agent tool) its own JSONL, beside the
// parent's, in the same record shape the parent transcript uses:
//
//   ~/.claude/projects/<slug>/<parentSessionId>.jsonl
//   ~/.claude/projects/<slug>/<parentSessionId>/subagents/agent-<agentId>.jsonl
//
// Verified on this machine 2026-09-18 (Claude Code 2.1.275): the `agentId: <id>`
// the Agent tool's result prints is exactly the `<id>` in the file name, and the
// phone already reads that id off the parent transcript to list the roster
// (`mobile-background-task-transcript.ts`). A `.meta.json` sits beside each file
// (agentType, description, spawnDepth, toolUseId); it is not read — the roster
// row already carries the title, and `files.read` is jailed to the worktree.
//
// The host reads it through `nativeChat.readSession` / `nativeChat.subscribe`
// with a client-supplied `transcriptPath`: any existing `.jsonl` path, no jail
// (`uP()` in the Orca bundle). Exercised against the live host the same day
// (Orca 1.4.201 running) — and that is where the trap showed up:
//
//   When the file does not exist yet, the host does NOT answer "not found".
//   It falls back to looking the transcript up by `sessionId`, and with the
//   parent's session id that lookup finds the PARENT transcript. A viewer that
//   sent the parent's id would paint the whole parent conversation under the
//   subagent's title for as long as the agent had not flushed a record.
//
// So the session id handed to the host is `agent-<agentId>`. It is the file's
// own basename, so the host's by-id walk (recursive, verified) can match only
// this subagent's file: an absent file then comes back `notFound`, which the
// host's subscribe turns into a pending snapshot, and the viewer says "nothing
// written yet". The bare id without `agent-` matches nothing at all.
//
// Codex has no subagents; a Codex roster row gets no target. The structured
// (SDK) lane's task ids come from Claude's own `task_started` system frame
// (`task_id`), the same id space the transcript's `<task-notification>` uses —
// read from the bundle, not exercised against an SDK session.

import type { MobileNativeChatStatus } from './use-mobile-native-chat-session'
import type { BackgroundTask } from './mobile-background-tasks'

export type SubagentTranscriptTarget = {
  agent: 'claude'
  agentId: string
  /** What the host resolves the file by when the path is absent or wrong:
   *  `agent-<id>`, which can only ever name this subagent's own file. */
  sessionId: string
  /** The file itself, when the parent's transcript path is known. Null leaves
   *  the host to find it by `sessionId`. */
  transcriptPath: string | null
  /** The roster row's title: the Task description, or the agent's name/type. */
  title: string
}

export type SubagentTranscriptBodyState =
  | { kind: 'loading' }
  | { kind: 'nothing-yet' }
  | { kind: 'messages' }
  | { kind: 'error'; message: string }

/** The alphabet the roster reader accepts for an id (`AGENT_LAUNCHED` in
 *  mobile-background-task-transcript.ts). The id becomes a path segment on
 *  the host, so anything outside it is refused, not escaped. */
const AGENT_ID = /^[A-Za-z0-9_-]+$/

const SESSION_KEY_PREFIX = 'agent-'
const TRANSCRIPT_EXT = '.jsonl'

const READ_FAILED_MESSAGE = 'The desktop could not read this transcript.'

function validAgentId(id: string): boolean {
  return AGENT_ID.test(id) && !id.startsWith(SESSION_KEY_PREFIX)
}

/** `<dir>/<parentSessionId>/subagents/agent-<id>.jsonl`, in the parent path's
 *  own separator style (the host resolves it on its own filesystem). Null when
 *  the parent path is not a `.jsonl` file or the id is not one. */
export function subagentTranscriptPath(parentTranscriptPath: string, agentId: string): string | null {
  if (!validAgentId(agentId) || !parentTranscriptPath.endsWith(TRANSCRIPT_EXT)) {
    return null
  }
  const separatorAt = Math.max(parentTranscriptPath.lastIndexOf('/'), parentTranscriptPath.lastIndexOf('\\'))
  const separator = parentTranscriptPath.includes('\\') && !parentTranscriptPath.includes('/') ? '\\' : '/'
  const directory = separatorAt === -1 ? '' : parentTranscriptPath.slice(0, separatorAt + 1)
  const parentSessionId = parentTranscriptPath.slice(separatorAt + 1, -TRANSCRIPT_EXT.length)
  if (parentSessionId.length === 0) {
    return null
  }
  return `${directory}${parentSessionId}${separator}subagents${separator}${SESSION_KEY_PREFIX}${agentId}${TRANSCRIPT_EXT}`
}

/** The read target for a roster row, or null when the row is not a Claude
 *  subagent — a shell, a monitor, anything on a Codex tab, or an id the phone
 *  invented for a placeholder row. */
export function subagentTranscriptTarget(args: {
  agent: string | null
  task: Pick<BackgroundTask, 'id' | 'kind' | 'title'>
  parentTranscriptPath: string | null
}): SubagentTranscriptTarget | null {
  const { agent, task, parentTranscriptPath } = args
  if (agent !== 'claude' || task.kind !== 'agent' || !validAgentId(task.id)) {
    return null
  }
  // Rows the phone pads in for an unnamed shell carry ids of its own making.
  if (task.id.startsWith('onscreen-shell-') || task.id === 'host-monitoring') {
    return null
  }
  return {
    agent: 'claude',
    agentId: task.id,
    sessionId: `${SESSION_KEY_PREFIX}${task.id}`,
    transcriptPath: parentTranscriptPath ? subagentTranscriptPath(parentTranscriptPath, task.id) : null,
    title: task.title
  }
}

/** What the viewer's body draws for the transcript hook's state. An absent
 *  file is a pending read, not a failure; a settled empty read is the same
 *  thing seen later. Turns already shown outrank an error card. */
export function subagentTranscriptBodyState(args: {
  status: MobileNativeChatStatus
  messageCount: number
  error?: string
}): SubagentTranscriptBodyState {
  const { status, messageCount, error } = args
  if (messageCount > 0) {
    return { kind: 'messages' }
  }
  switch (status) {
    case 'idle':
    case 'loading':
    case 'waiting-session':
      return { kind: 'loading' }
    case 'awaiting-transcript':
    case 'ready':
      return { kind: 'nothing-yet' }
    case 'error':
      return { kind: 'error', message: error?.trim() || READ_FAILED_MESSAGE }
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}
