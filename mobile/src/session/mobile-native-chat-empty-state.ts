import { formatAgentTypeLabel } from '../../../src/shared/agent-type-label'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import {
  formatNativeChatEmptyStateCopy,
  type NativeChatEmptyStateCopy
} from '../../../src/shared/native-chat-empty-state'
import type { MobileNativeChatStatus } from './use-mobile-native-chat-session'
import type { NativeChatSessionIdentity } from './native-chat-kept-session'

export type MobileNativeChatEmptyStateCopy = NativeChatEmptyStateCopy & {
  /** A muted line under the invitation saying why there is nothing to read,
   *  when the reason is not "the conversation is empty". */
  detail?: string
}

/** What the chat knows about the session behind an empty list. */
export type MobileNativeChatEmptyStateEvidence = {
  /** The pane's status: the same object the chat took its session from. */
  agentStatus?: AgentStatusEntry | null
  /** Rows the last read returned, before noise and folding. */
  transcriptMessageCount?: number
  /** The session the chat reads, and the one a nested agent's status named
   *  instead (native-chat-kept-session.ts). Absent: the status's own session. */
  sessionIdentity?: NativeChatSessionIdentity | null
}

/** Agents whose own hooks name their transcript on every event, so a status
 *  of theirs that names none is most likely another agent's
 *  (native-chat-kept-session.ts). */
const NAMES_ITS_TRANSCRIPT: ReadonlySet<string> = new Set(['claude', 'codex'])

/** How much of a session id the line names: enough to tell two sessions apart
 *  at a glance and to find the id in the desktop's own records. */
const SESSION_ID_SHOWN_CHARS = 8

/** The session has already taken a turn, so an empty chat is not its history.
 *  A `done` that only marks a session boundary (Claude's SessionStart, before
 *  the transcript file exists) is a session that has not started yet. A resume
 *  reports the same boundary, so a resumed session that reads empty before its
 *  first new turn gets no line either; the next turn's status brings it. */
function sessionHasTakenTurns(status: AgentStatusEntry): boolean {
  return (
    status.state !== 'done' ||
    status.sessionBoundary !== true ||
    status.prompt.trim().length > 0 ||
    (status.lastAssistantMessage?.trim().length ?? 0) > 0
  )
}

function emptyConversationDetail(
  status: MobileNativeChatStatus,
  agent: string | null,
  agentLabel: string,
  evidence: MobileNativeChatEmptyStateEvidence
): string | undefined {
  const nestedId = evidence.sessionIdentity?.nestedSessionId ?? null
  const readId = evidence.sessionIdentity?.sessionId ?? null
  if (nestedId !== null && readId !== null && readId !== nestedId) {
    // The pane's status is a nested agent's, and the chat reads the session the
    // tab's own agent last named; that read is what came back empty.
    const kept = `Another agent started in this tab reported session ${nestedId.slice(0, SESSION_ID_SHOWN_CHARS)}. The chat stays on ${agentLabel}'s own session ${readId.slice(0, SESSION_ID_SHOWN_CHARS)}`
    return status === 'awaiting-transcript'
      ? `${kept}, which the desktop has no transcript for.`
      : evidence.transcriptMessageCount === 0
        ? `${kept}, which the desktop read and sent no messages for.`
        : undefined
  }
  if (nestedId !== null && status === 'awaiting-transcript') {
    // A nested agent's status with nothing kept to read instead: the chat
    // withholds that status (so `agentStatus` is empty here) and asks for its
    // session as reported, which the desktop has no transcript for.
    return nestedSessionDetail(nestedId, agentLabel)
  }
  const agentStatus = evidence.agentStatus
  if (!agentStatus) {
    // No status for this pane yet: a tab the phone just launched. Nothing is
    // wrong with it, and nothing is known to say.
    return undefined
  }
  const session = agentStatus.providerSession
  const shortId = (readId ?? session?.id)?.slice(0, SESSION_ID_SHOWN_CHARS)
  const transcriptNamed = Boolean(evidence.sessionIdentity?.transcriptPath ?? session?.transcriptPath)
  if (status === 'waiting-session') {
    return 'The desktop reports this pane but not which session runs in it, so there is no transcript to read.'
  }
  if (!shortId || !sessionHasTakenTurns(agentStatus)) {
    return undefined
  }
  if (status === 'awaiting-transcript') {
    if (transcriptNamed) {
      return `The desktop has no transcript for session ${shortId}.`
    }
    // 2026-09-28: a Grok launched from Claude's Bash tool posted as the pane,
    // and "no transcript file was named for it" was all the phone could say.
    // The agent's own hooks always name one, so the likely cause is worth saying.
    return agent !== null && NAMES_ITS_TRANSCRIPT.has(agent)
      ? nestedSessionDetail(shortId, agentLabel)
      : `The desktop has no transcript for session ${shortId}, and no transcript file was named for it.`
  }
  // `ready`: the read settled. With rows that all folded away it did send
  // something, so only a read that returned nothing is called out.
  return evidence.transcriptMessageCount === 0
    ? `The desktop read session ${shortId} and sent no messages.`
    : undefined
}

/** A session whose status named no transcript, on an agent whose own hooks
 *  always name one: most likely an agent started inside the tab. */
function nestedSessionDetail(sessionId: string, agentLabel: string): string {
  return `Session ${sessionId.slice(0, SESSION_ID_SHOWN_CHARS)} is most likely another agent's, started in this tab: its status named no transcript file, where ${agentLabel}'s own always name one, and the desktop has no ${agentLabel} transcript for it.`
}

/** The centered empty-state copy for a chat with no messages, mirroring the
 *  desktop `NativeChatEmptyState` (shared copy + agent label) so the two surfaces
 *  stay in lockstep. Returns null when the list should stay bare (idle, or the
 *  loading spinner owns the view). */
export function mobileNativeChatEmptyState(
  status: MobileNativeChatStatus,
  agent: string | null,
  error?: string,
  evidence: MobileNativeChatEmptyStateEvidence = {}
): MobileNativeChatEmptyStateCopy | null {
  const agentLabel = agent ? formatAgentTypeLabel(agent) : 'the agent'
  switch (status) {
    // A live agent with no transcript yet — an unwritten transcript file, or a
    // loaded-but-empty one — is "start a chat"; invite the first message instead
    // of implying the agent is still starting up. But on 2026-09-25 (one pane of
    // a four-pane split, phone 0.9.54) the same invitation stood over a
    // 13,000-line conversation, with nothing on screen saying whether the pane
    // named no session, the desktop found no file, or the read came back empty.
    // Once the pane has a status of its own, a muted line says which; a session
    // that has only just started is an empty conversation and gets none.
    case 'waiting-session':
    case 'awaiting-transcript':
    case 'ready': {
      const copy = formatNativeChatEmptyStateCopy('empty', agentLabel)
      const detail = emptyConversationDetail(status, agent, agentLabel, evidence)
      return detail ? { ...copy, detail } : copy
    }
    case 'error': {
      const copy = formatNativeChatEmptyStateCopy('error', agentLabel)
      return error ? { ...copy, subtitle: error } : copy
    }
    case 'idle':
    case 'loading':
      return null
    default: {
      const unhandled: never = status
      return unhandled
    }
  }
}
