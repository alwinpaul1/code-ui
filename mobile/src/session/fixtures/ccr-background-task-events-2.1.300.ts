import type { CcrEvent } from '../ccr-session-api'
import { BACKGROUND_AGENT } from './claude-background-agent-launch-2.1.296'

// ─── Anthropic's task events for a Claude tab, as Claude Code 2.1.300 emits them ────────────────
//
// NOT captured live: no session was driven to record these (subagents may not launch Claude). The
// field names and nesting are copied from Claude Code 2.1.300's own emitters (its bundle, strings
// read 2026-10-15):
//   {type:"system",subtype:"task_started",task_id,run_id,owned_by_subagent,tool_use_id,description,
//    subagent_type,is_backgrounded,…,parent_task_id,task_type,workflow_name,…}
//   {type:"system",subtype:"task_notification",task_id,run_id,tool_use_id,status,output_file,summary,usage,…}
//   {type:"system",subtype:"task_updated",task_id,run_id,patch:{status?,description?,end_time?,…}}
//   {type:"system",subtype:"background_tasks_changed",tasks:[{task_id,task_type,subagent_type,description,parent_task_id,…}]}
// and the Claude app reads the same names (jau.java's descriptor, 1.261013.20). The agent's id,
// description and Agent call id are the real 2.1.296 launch's (claude-background-agent-launch-2.1.296.ts).

export const SESSION = 'session_01AnthropicTasksFixture'
export const AGENT_CALL = 'toolu_01Agent2p1p300CommandsSheet'
export const SHELL_ID = 'bzp6f42la'
export const SHELL_CALL = 'toolu_01Shell2p1p300Rpc'
export const T0 = Date.parse('2026-10-15T09:00:00.000Z')

let seq = 0
export function ccrEvent(payload: Record<string, unknown>, at: number): CcrEvent {
  seq += 1
  return { eventId: `evt_${seq}`, payload: { uuid: `uuid-${seq}`, session_id: SESSION, ...payload }, sequenceNum: seq, source: 'worker', createdAt: at }
}

export function taskStarted(fields: { taskId: string; toolUseId: string; taskType: string; description: string; at: number; runId?: string; backgrounded?: boolean }): CcrEvent {
  return ccrEvent(
    {
      type: 'system',
      subtype: 'task_started',
      task_id: fields.taskId,
      run_id: fields.runId ?? `${fields.taskId}:1`,
      tool_use_id: fields.toolUseId,
      description: fields.description,
      is_backgrounded: fields.backgrounded ?? true,
      task_type: fields.taskType
    },
    fields.at
  )
}

export function taskNotification(fields: { taskId: string; toolUseId: string; status: string; at: number; summary?: string; runId?: string }): CcrEvent {
  return ccrEvent(
    {
      type: 'system',
      subtype: 'task_notification',
      task_id: fields.taskId,
      run_id: fields.runId ?? `${fields.taskId}:1`,
      tool_use_id: fields.toolUseId,
      status: fields.status,
      output_file: '',
      summary: fields.summary ?? ''
    },
    fields.at
  )
}

export function taskUpdated(taskId: string, patch: Record<string, unknown>, at: number): CcrEvent {
  return ccrEvent({ type: 'system', subtype: 'task_updated', task_id: taskId, run_id: `${taskId}:1`, patch }, at)
}

export function tasksChanged(tasks: { taskId: string; taskType: string }[], at: number): CcrEvent {
  return ccrEvent({ type: 'system', subtype: 'background_tasks_changed', tasks: tasks.map((task) => ({ task_id: task.taskId, task_type: task.taskType })) }, at)
}

/** The real agent and a shell, both started, the shell 3m 44s before `T0 + 600 s`. */
export function agentAndShellStarted(): CcrEvent[] {
  return [
    taskStarted({ taskId: BACKGROUND_AGENT.agentId, toolUseId: AGENT_CALL, taskType: 'local_agent', description: BACKGROUND_AGENT.description, at: T0 }),
    taskStarted({ taskId: SHELL_ID, toolUseId: SHELL_CALL, taskType: 'local_bash', description: 'Rerun the rpc-recording suite', at: T0 + 376_000 }),
    tasksChanged(
      [
        { taskId: BACKGROUND_AGENT.agentId, taskType: 'local_agent' },
        { taskId: SHELL_ID, taskType: 'local_bash' }
      ],
      T0 + 376_000
    )
  ]
}

/** The lead's Agent call, as Anthropic's stream carries it, and its launch acknowledgement. */
export function agentCallEvents(launchText: string, prompt: string): CcrEvent[] {
  return [
    ccrEvent(
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'tool_use', id: AGENT_CALL, name: 'Agent', input: { description: BACKGROUND_AGENT.description, prompt, run_in_background: true } }]
        }
      },
      T0 - 1_000
    ),
    ccrEvent(
      {
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: AGENT_CALL, content: [{ type: 'text', text: launchText }] }] }
      },
      T0 - 500
    )
  ]
}

/** One call the subagent made, and its result, both scoped to the lead's Agent call. */
export function subagentBashCall(id: string, command: string, description: string, at: number): CcrEvent[] {
  return [
    ccrEvent(
      {
        type: 'assistant',
        parent_tool_use_id: AGENT_CALL,
        message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description } }] }
      },
      at
    ),
    ccrEvent(
      {
        type: 'user',
        parent_tool_use_id: AGENT_CALL,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }
      },
      at + 500
    )
  ]
}

/** A line of the subagent's own text, scoped to the lead's Agent call: no call in it. */
export function subagentText(text: string, at: number): CcrEvent {
  return ccrEvent(
    { type: 'assistant', parent_tool_use_id: AGENT_CALL, message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }] } },
    at
  )
}
