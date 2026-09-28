import type { AgentSubagentSnapshot } from '../../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'
import { agentFinishedNotification } from './claude-parallel-agents-2.1.281'

// ─── A background agent that failed and was resumed, Claude Code 2.1.283 ────
//
// Session 790eafa8, 2026-09-28. The lead launched a38e1687ac3722765 in the
// background at 12:18; it stalled and its notification said `failed` at
// 13:34; the lead resumed it with SendMessage at 16:28, then messaged it twice
// more while it ran. The phone (0.9.102) read "Working · Tools" with no
// running task while it ran.
//
// Every result below is the record's own text, from the lead's JSONL
// (records 22977, 23088, 23099, 23145, 23211), as extracted for this bug: the
// launch result and the notification were cut by that extract where the
// `…` and the unclosed <note> show, after every field the reader uses. The
// SendMessage calls (records 23097, 23143, 23209) keep their `to`, `summary`,
// `type` and `recipient`; the message bodies are placeholders, they were not
// read. The Agent call's own record is not in the extract: its description
// is the one its result echoed (`toolUseResult.description`), its type the one
// Orca's roster gave the agent, and its time the result's.
//
// The roster row is Orca's own, from agent-hooks/last-status.json read at
// 16:45: still `working`, still carrying its FIRST start, 12:18:28.952. The
// stalled run sent no SubagentStop, so the row outlived it, and the resume's
// SubagentStart found the row and kept its start.

export const RESUMED_AGENT_ID = 'a38e1687ac3722765'
export const RESUMED_AGENT_DESCRIPTION = 'Find the Fabric removeViewAt crash'

export const RESUMED_AGENT_TIMES = {
  launched: '2026-09-28T12:18:28.976Z',
  failed: '2026-09-28T13:34:12.164Z',
  resumeCall: '2026-09-28T16:28:09.161Z',
  resumed: '2026-09-28T16:28:13.351Z',
  firstQueuedCall: '2026-09-28T16:30:34.575Z',
  firstQueued: '2026-09-28T16:30:35.523Z',
  secondQueuedCall: '2026-09-28T16:35:26.062Z',
  secondQueued: '2026-09-28T16:35:27.145Z'
} as const

/** Record 22977, the background launch's result. */
export const LAUNCH_RESULT =
  "Async agent launched successfully. (This tool result is internal metadata \u2014 never quote or paste any part of it, including the agentId below, into a user-facing reply.)\nagentId: a38e1687ac3722765 (internal ID - do not mention to user. Use SendMessage with to: 'a38e1687ac3722765', summary: '<5-10 word recap>' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes. You know nothing about its results until that notification arrives \u2014 do\u2026"

/** Record 23088, the stalled run's notification. */
export const FAILED_NOTIFICATION =
  "<task-notification>\n<task-id>a38e1687ac3722765</task-id>\n<tool-use-id>toolu_01HjWvydx4Mw65JxPCvBfyFX</tool-use-id>\n<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/tasks/a38e1687ac3722765.output</output-file>\n<status>failed</status>\n<summary>Agent \"Find the Fabric removeViewAt crash\" failed: Agent stalled: no progress for 600s (stream watchdog did not recover)</summary>\n<note>A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so th"

/** Record 23099: the resume. */
export const RESUME_RESULT =
  "{\"success\":true,\"message\":\"Resuming agent a38e168\",\"resumedAgentId\":\"a38e1687ac3722765\",\"pin\":{\"id\":\"a38e1687ac3722765\",\"name\":\"a38e1687ac3722765\",\"ref\":\"b55c0d\"}}"

/** Records 23145 and 23211: a message to the agent while it runs. */
export const QUEUED_RESULT =
  "{\"success\":true,\"message\":\"Message queued for delivery to a38e1687ac3722765 at its next tool round.\",\"pin\":{\"id\":\"a38e1687ac3722765\",\"name\":\"a38e1687ac3722765\",\"ref\":\"b55c0d\"}}"

/** Orca's roster row for the agent, `startedAt` 2026-09-28T12:18:28.952Z. */
export const RESUMED_AGENT_ROSTER_ROW: AgentSubagentSnapshot = {
  id: RESUMED_AGENT_ID,
  state: 'working',
  startedAt: 1790597908952,
  agentType: 'general-purpose',
  description: RESUMED_AGENT_DESCRIPTION
}

/** A reviewer the resumed agent started at 16:35:03.323, on the same roster
 *  (same file): not the lead's. */
export const RESUMED_AGENTS_REVIEWER_ROW: AgentSubagentSnapshot = {
  id: 'af42aa86e554e63ea',
  state: 'working',
  startedAt: 1790613303323,
  agentType: 'general-purpose',
  description: 'Opus review of Fabric crash containment'
}

/** The pane's working state began at 12:16:28.128 and never left it: the
 *  stale row kept it working through the three idle hours. */
export const RESUMED_AGENT_PANE_STARTED_AT = 1790597788128

let nextId = 0
function record(role: NativeChatMessage['role'], at: string, block: NativeChatMessage['blocks'][number]): NativeChatMessage {
  nextId += 1
  return { id: `resumed-agent-${nextId}`, role, timestamp: Date.parse(at), source: 'transcript', blocks: [block] }
}

export function launchRecords(): NativeChatMessage[] {
  return [
    record('assistant', RESUMED_AGENT_TIMES.launched, {
      type: 'tool-call',
      name: 'Agent',
      input: { description: RESUMED_AGENT_DESCRIPTION, prompt: '[prompt]', subagent_type: 'general-purpose', run_in_background: true }
    }),
    record('user', RESUMED_AGENT_TIMES.launched, { type: 'tool-result', output: LAUNCH_RESULT })
  ]
}

/** An agent notification at `at`; by default record 23088 itself. */
export function notificationRecord(at: string = RESUMED_AGENT_TIMES.failed, text: string = FAILED_NOTIFICATION): NativeChatMessage {
  return record('user', at, { type: 'text', text })
}

/** A clean finish of the same agent, in the shape of a real completed agent
 *  notification (record 528 of session 967668df, Claude Code 2.1.281). */
export const COMPLETED_NOTIFICATION = agentFinishedNotification(RESUMED_AGENT_ID, RESUMED_AGENT_DESCRIPTION)

/** A SendMessage call to the agent and its result. */
export function sendMessageRecords(
  callAt: string,
  resultAt: string,
  output: string,
  summary: string,
  to: string = RESUMED_AGENT_ID
): NativeChatMessage[] {
  return [
    record('assistant', callAt, {
      type: 'tool-call',
      name: 'SendMessage',
      input: { to, message: '[message]', summary, type: 'message', recipient: to, content: '[message]' }
    }),
    record('user', resultAt, { type: 'tool-result', output })
  ]
}

/** Records 23097 and 23099: the resume, 3 h after the failure. */
export function resumeRecords(): NativeChatMessage[] {
  return sendMessageRecords(
    RESUMED_AGENT_TIMES.resumeCall,
    RESUMED_AGENT_TIMES.resumed,
    RESUME_RESULT,
    'Resume the crash agent without a native harness'
  )
}

/** Records 23143/23145 and 23209/23211: two messages queued while it ran. */
export function queuedRecords(): NativeChatMessage[] {
  return [
    ...sendMessageRecords(RESUMED_AGENT_TIMES.firstQueuedCall, RESUMED_AGENT_TIMES.firstQueued, QUEUED_RESULT, 'Approve containment with conditions'),
    ...sendMessageRecords(
      RESUMED_AGENT_TIMES.secondQueuedCall,
      RESUMED_AGENT_TIMES.secondQueued,
      QUEUED_RESULT,
      'Narrow the lead to the three permission paths'
    )
  ]
}
