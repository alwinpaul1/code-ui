import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
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
const WORKFLOW_AGENT_TYPE = 'workflow-subagent'

export type WorkflowAgent = { id: string; label: string | null }
export type WorkflowPhase = { title: string; detail: string | null; agents: WorkflowAgent[] }
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
  /** From the script's meta; null when it could not be read. */
  phases: WorkflowPhase[] | null
  /** Running agents no phase claims (an unnamed one, a label that names no
   *  phase), or all of them when there is no meta. */
  otherAgents: WorkflowAgent[]
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
      phases: meta?.phases?.map((phase) => ({ ...phase, agents: [] })) ?? null,
      otherAgents: [],
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

/** Move the roster's workflow lanes into the running workflow that owns them.
 *  A lane is folded only when exactly one running workflow can own it: the
 *  only one there is, or the only one whose meta has a phase the label starts
 *  with (`review:markdown` for a phase titled Review). The row carries no
 *  workflow id, so with several running and no such match nothing says whose
 *  it is, and it stays the agent row it was. */
export function foldWorkflowAgents(
  tasks: BackgroundTasks,
  subagents: readonly AgentSubagentSnapshot[] | undefined,
  hostDone: boolean
): BackgroundTasks {
  const workflows = tasks.running.filter((task) => task.kind === 'workflow' && task.workflow)
  const lanes = hostDone ? [] : (subagents ?? []).filter((row) => row.state !== 'idle' && row.agentType?.trim() === WORKFLOW_AGENT_TYPE)
  if (workflows.length === 0 || lanes.length === 0) {
    return tasks
  }
  const folded = new Set<string>()
  const details = new Map<string, WorkflowDetail>(
    workflows.map((task) => [task.id, cloneDetail(task.workflow!)] as const)
  )
  for (const lane of lanes) {
    const agent = { id: lane.id, label: lane.description?.trim() || null }
    const owners = workflows.length === 1 ? workflows : workflows.filter((task) => phaseFor(details.get(task.id)!, agent.label) !== null)
    const owner = owners.length === 1 ? owners[0] : undefined
    if (owner === undefined) {
      continue
    }
    const detail = details.get(owner.id)!
    const phase = phaseFor(detail, agent.label)
    ;(phase?.agents ?? detail.otherAgents).push(agent)
    folded.add(lane.id)
  }
  return {
    running: tasks.running
      .filter((task) => !(task.kind === 'agent' && folded.has(task.id)))
      .map((task): BackgroundTask => (details.has(task.id) ? { ...task, workflow: details.get(task.id)! } : task)),
    finished: tasks.finished
  }
}

function cloneDetail(detail: WorkflowDetail): WorkflowDetail {
  return {
    ...detail,
    phases: detail.phases?.map((phase) => ({ ...phase, agents: [] })) ?? null,
    otherAgents: []
  }
}

function phaseFor(detail: WorkflowDetail, label: string | null): WorkflowPhase | null {
  if (label === null || detail.phases === null) {
    return null
  }
  const lower = label.toLowerCase()
  return detail.phases.find((phase) => lower.startsWith(`${phase.title.toLowerCase()}:`)) ?? null
}
