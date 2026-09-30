import { AGENT_STATUS_MAX_SUBAGENTS, type AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import { parseWorkflowMeta } from './mobile-workflow-meta'
import type { BackgroundTask, BackgroundTasks } from './mobile-background-tasks'

// ─── A Workflow is one task, and its agents belong inside it ─────────────────
//
// What the phone can know (Claude Code 2.1.284, docs/mobile-background-tasks.md
// "A Workflow is one task"): the lead's transcript holds the `Workflow` call
// (its script opens with the meta literal), the launch result (task id, the
// description, run id) and, at the end, a <task-notification> whose `<usage>`
// block totals agents, tokens and time. While it runs, the agents are the
// host roster's `workflow-subagent` rows: a label (`description`) once
// Claude's inventory has named it, no phase, no workflow id, no tokens, and
// no row at all once an agent is done. So a running card can list the agents
// that are running now, and nothing about the ones that finished.

/** What the roster calls a lane a workflow started. */
export const WORKFLOW_AGENT_TYPE = 'workflow-subagent'

export type WorkflowPhase = { title: string; detail: string | null }
/** How many workflow lanes the roster shows running. `atLeast` when the roster
 *  was full, so lanes may be missing from it. */
export type WorkflowLanes = { count: number; atLeast: boolean }
/** The totals Claude states in a finished workflow's notification. A field
 *  the notification did not carry is null, never zero. */
export type WorkflowUsage = {
  agents: number | null
  tokens: number | null
  durationMs: number | null
  /** `agents_error` and `agents_skipped`; null when the block does not say. */
  failed: number | null
  skipped: number | null
}

export type WorkflowDetail = {
  description: string | null
  /** From the script's meta, titles and details only: nothing says which agent
   *  is in which phase. Null when the meta could not be read. */
  phases: WorkflowPhase[] | null
  /** Lanes running now, set only where they can be put on this workflow. */
  lanes: WorkflowLanes | null
  /** Set once the workflow has finished and said so; null before. */
  usage: WorkflowUsage | null
}

const LAUNCHED = /^\s*Workflow launched in background\.\s*Task ID:\s*([A-Za-z0-9_-]+)/
const SUMMARY_LINE = /^Summary:[ \t]*(.+)$/m
const SCRIPT_FILE_LINE = /^Script file:[ \t]*(.+)$/m
const RUN_ID_LINE = /^Run ID:[ \t]*([A-Za-z0-9_-]+)/m

/** The workflow's name when the meta gave none (an unreadable or cut script, or
 *  a `scriptPath` re-run that carries no script): the launch result's
 *  `Script file: …/<name>-<runId>.js` line names the file after both. */
function nameFromScriptFile(output: string): string | null {
  const path = SCRIPT_FILE_LINE.exec(output)?.[1]?.trim()
  const file = path?.split(/[\\/]/).pop()
  if (!file?.endsWith('.js')) {
    return null
  }
  const runId = RUN_ID_LINE.exec(output)?.[1]
  const stem = file.slice(0, -3)
  const name = runId && stem.endsWith(`-${runId}`) ? stem.slice(0, -(runId.length + 1)) : stem.replace(/-wf_[A-Za-z0-9_-]+$/, '')
  return name.length > 0 ? name : null
}

/** The task and detail a Workflow call+result launched, or null when the
 *  result does not say a workflow started. */
export function readWorkflowLaunch(input: unknown, output: string): { id: string; title: string; detail: WorkflowDetail } | null {
  const id = LAUNCHED.exec(output)?.[1]
  if (!id) {
    return null
  }
  const meta = parseWorkflowMeta(scriptOf(input))
  return {
    id,
    title: meta?.name ?? nameFromScriptFile(output) ?? 'Workflow',
    detail: {
      // The launch result repeats the description, so an unreadable script
      // still leaves the sentence.
      description: meta?.description ?? SUMMARY_LINE.exec(output)?.[1]?.trim() ?? null,
      phases: meta?.phases ?? null,
      lanes: null,
      usage: null
    }
  }
}

function scriptOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    return ''
  }
  const script = Reflect.get(input, 'script')
  return typeof script === 'string' ? script : ''
}

/** `<usage><agent_count>37</agent_count>…<subagent_tokens>…</subagent_tokens>
 *  …<duration_ms>…</duration_ms></usage>`; null with no such block.
 *  The notification's `<result>` comes first and is written by the model, so it
 *  can quote a usage block: only the text after `</result>` is read, and a body
 *  that ends inside the result has none. The last block wins. */
export function readWorkflowUsage(notificationBody: string): WorkflowUsage | null {
  const resultEnd = notificationBody.lastIndexOf('</result>')
  if (resultEnd === -1 && notificationBody.includes('<result>')) {
    return null
  }
  const tail = resultEnd === -1 ? notificationBody : notificationBody.slice(resultEnd)
  const block = [...tail.matchAll(/<usage>([\S\s]*?)<\/usage>/g)].at(-1)?.[1]
  if (!block) {
    return null
  }
  const number = (tag: string): number | null => {
    const value = new RegExp(`<${tag}>\\s*(\\d+)\\s*</${tag}>`).exec(block)?.[1]
    return value === undefined ? null : Number(value)
  }
  const usage = {
    agents: number('agent_count'),
    tokens: number('subagent_tokens'),
    durationMs: number('duration_ms'),
    failed: number('agents_error'),
    skipped: number('agents_skipped')
  }
  return Object.values(usage).every((value) => value === null) ? null : usage
}

/** Count the roster's workflow lanes on the one running workflow they can be
 *  put on, and take them off the running list.
 *
 *  A lane row names no workflow, no phase and (in production, Claude Code
 *  2.1.284) no label, so a lane is put on a card only when nothing says it could
 *  be another workflow's:
 *   - exactly one workflow is running in the loaded window;
 *   - the agent's own beacon has named what is running, and every id on it is a
 *     launch the window showed (a workflow launched above the window is running
 *     and would be on that list, not in the window);
 *   - the lane started after this workflow was launched;
 *   - the host does not say the pane is done.
 *  Otherwise nothing changes: the lanes stay the agent rows they were. */
export function foldWorkflowAgents(
  tasks: BackgroundTasks,
  subagents: readonly AgentSubagentSnapshot[] | undefined,
  evidence: { hostDone: boolean; beaconRunning: readonly string[] | null; launchedIds: ReadonlySet<string> }
): BackgroundTasks {
  const workflows = tasks.running.filter((task) => task.kind === 'workflow' && task.workflow)
  const [workflow] = workflows
  const launchedAt = workflow?.startedAt ?? null
  if (
    workflows.length !== 1 ||
    workflow === undefined ||
    launchedAt === null ||
    evidence.hostDone ||
    evidence.beaconRunning === null ||
    !evidence.beaconRunning.every((id) => evidence.launchedIds.has(id))
  ) {
    return tasks
  }
  const rows = subagents ?? []
  const lanes = rows.filter(
    (row) => row.state !== 'idle' && row.agentType?.trim() === WORKFLOW_AGENT_TYPE && row.startedAt >= launchedAt
  )
  if (lanes.length === 0) {
    return tasks
  }
  const folded = new Set(lanes.map((lane) => lane.id))
  const counted: WorkflowLanes = { count: lanes.length, atLeast: rows.length >= AGENT_STATUS_MAX_SUBAGENTS }
  return {
    running: tasks.running
      .filter((task) => !(task.kind === 'agent' && folded.has(task.id)))
      .map((task): BackgroundTask => (task === workflow ? { ...task, workflow: { ...task.workflow!, lanes: counted } } : task)),
    finished: tasks.finished
  }
}
