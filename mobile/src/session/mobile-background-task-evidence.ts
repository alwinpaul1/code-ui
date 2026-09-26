import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import {
  isTextBlock,
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatMessage
} from '../../../src/shared/native-chat-types'
import type { HeldShellCount } from './mobile-background-task-footer'
import {
  INTERRUPTED,
  readLaunch,
  readNotifications,
  readString,
  type PendingCall
} from './mobile-background-task-transcript'
import { rememberFinishedTaskIds } from './mobile-finished-task-id-memory'

// ─── What the phone has seen of a session's background work, kept ───────────
//
// Every source the running-task reader weighs is a window: the loaded page of
// the transcript slides, the roster can be absent from one snapshot, the
// agent's footer leaves the screen under a dialog. A task a source retired, or
// placed, must not flip back the moment that source looks away. So what each
// one proved is remembered here, per session, for as long as the app runs:
//
//   - `ownAgentIds`: agents the LEAD's transcript launched or messaged. The
//     roster cannot tell the lead's agents from the reviewers they start, and
//     the loaded window soon scrolls past a launch.
//   - `preexistingAgentIds`: rows already running the first time the phone
//     read this session's roster, which it cannot place either way.
//   - `retiredTaskIds`: ids a window showed ending (a notification, a
//     TaskStop). A stopped shell has no notification at all — bhcfbe9vf,
//     stopped at 00:20:27 in session 967668df — and the status line's `bg=`
//     and `live=` keep naming it, so once the TaskStop scrolled out of the
//     window the shell came back as running.
//   - the last host status and the last footer reading, for the moments either
//     is missing.

/** What one window of a transcript proves. */
export type WindowTaskEvidence = { ownAgentIds: string[]; retiredTaskIds: string[] }

/** Agent ids, and names given to SendMessage, are this alphabet. */
const TARGET = /^[A-Za-z0-9_@.-]+$/

/** Launches and endings in one loaded window, paired the way
 *  `deriveBackgroundTasks` pairs them: first in, first out, with an
 *  interrupted turn's unanswered calls dropped. */
export function readTaskEvidence(messages: readonly NativeChatMessage[]): WindowTaskEvidence {
  const pending: PendingCall[] = []
  const ownAgentIds: string[] = []
  const retiredTaskIds: string[] = []
  for (const message of messages) {
    let text = ''
    for (const block of message.blocks) {
      if (isToolCallBlock(block)) {
        pending.push({ name: block.name, input: block.input, startedAt: message.timestamp })
        const stopped = block.name === 'TaskStop' ? readString(block.input, 'task_id') : null
        if (stopped) {
          retiredTaskIds.push(stopped)
        }
        // The lead messaging an agent is the lead's own agent, and a message
        // resumes one that had finished — with no new Agent launch to show it.
        const target = block.name === 'SendMessage' ? readString(block.input, 'to') : null
        if (target && TARGET.test(target)) {
          ownAgentIds.push(target)
        }
      } else if (isToolResultBlock(block)) {
        const call = pending.shift()
        const launch = call ? readLaunch(call, block.output) : null
        if (launch?.kind === 'agent') {
          ownAgentIds.push(launch.id)
        }
      } else if (isTextBlock(block)) {
        text += block.text
      }
    }
    if (INTERRUPTED.test(text)) {
      pending.length = 0
    }
    for (const notification of readNotifications(text, 0)) {
      retiredTaskIds.push(notification.id)
    }
  }
  return { ownAgentIds, retiredTaskIds }
}

export type SessionTaskEvidence = {
  ownAgentIds: readonly string[]
  /** Null until the phone first reads this session's roster. */
  preexistingAgentIds: readonly string[] | null
  retiredTaskIds: readonly string[]
  /** The last host status seen for the session, and when (phone clock). */
  lastStatus: { status: AgentStatusEntry; at: number } | null
  /** The last footer count seen, and when (phone clock). */
  lastShellCount: HeldShellCount | null
}

export const EMPTY_SESSION_TASK_EVIDENCE: SessionTaskEvidence = {
  ownAgentIds: [],
  preexistingAgentIds: null,
  retiredTaskIds: [],
  lastStatus: null,
  lastShellCount: null
}

/** Folds what the phone sees now into what it has seen. The id lists come
 *  back as the SAME arrays when nothing new arrived, so readers keyed on them
 *  do not recount. */
export function rememberTaskEvidence(
  previous: SessionTaskEvidence,
  seen: {
    window: WindowTaskEvidence
    agentStatus: AgentStatusEntry | null
    onScreenShellCount: number | null
    now: number
  }
): SessionTaskEvidence {
  const { window, agentStatus, onScreenShellCount, now } = seen
  return {
    ownAgentIds: rememberFinishedTaskIds(previous.ownAgentIds, window.ownAgentIds),
    retiredTaskIds: rememberFinishedTaskIds(previous.retiredTaskIds, window.retiredTaskIds),
    preexistingAgentIds: keepPreexisting(previous.preexistingAgentIds, agentStatus),
    lastStatus: agentStatus ? { status: agentStatus, at: now } : previous.lastStatus,
    lastShellCount: onScreenShellCount === null ? previous.lastShellCount : { count: onScreenShellCount, at: now }
  }
}

/** The first roster's working rows, and afterwards only those still working.
 *  A row that stopped and came back was resumed by whoever started it: the
 *  lead's SendMessage is in its transcript (`ownAgentIds`), a subagent's is not
 *  — a874 in session 967668df, a reviewer already running at the first look,
 *  finished at 00:03:54 and was resumed by its parent at 00:27:07. */
function keepPreexisting(
  previous: readonly string[] | null,
  agentStatus: AgentStatusEntry | null
): readonly string[] | null {
  if (agentStatus === null) {
    return previous
  }
  const working = (agentStatus.subagents ?? []).filter((row) => row.state !== 'idle').map((row) => row.id)
  if (previous === null) {
    return working
  }
  const still = new Set(working)
  return previous.every((id) => still.has(id)) ? previous : previous.filter((id) => still.has(id))
}
