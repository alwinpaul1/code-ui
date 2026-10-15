import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { CcrEvent } from './ccr-session-api'
import { decodeCcrEvent } from './ccr-transcript-decode'
import type { BackgroundTask, BackgroundTaskKind, BackgroundTasks, BackgroundTaskStatus } from './mobile-background-tasks'
import { captionOf, elapsedSince } from './mobile-background-task-captions'
import { noteStreamRowWithoutUuid } from './subagent-stream-file-union'

/**
 * A Claude tab's background tasks as the Claude app lists them, read from Anthropic's copy of the
 * Remote Control session (decompiled com.anthropic.claude 1.261013.20, R8 names of that build).
 *
 * The app keeps one record per `task_id` (`cs2`, "BackgroundTask(taskId=, toolUseId=, taskType=,
 * description=, …, status=Running|Completed|Failed|Stopped, startedAtMillis=, completedAtMillis=,
 * …, summary=, outputFile=, isBackgrounded=, runId=)") and folds four top-level `system` subtypes
 * into it (t5v.java `k`, 2758-3100; `h`, 2551-2643):
 *
 *  - `task_started`: a new record runs from the event's `created_at`; it takes `tool_use_id`,
 *    `task_type` and `description` where the event states them.
 *  - `task_progress`: only a running record; a description fills one still named by its id.
 *  - `task_updated`: `patch.status` completed → Completed, failed → Failed, stopped / killed /
 *    cancelled → Stopped (a running record moves, and one only the list stopped); `patch.description`
 *    renames it.
 *  - `task_notification`: a running record ends with `status` read the same way, an unknown status
 *    reading as Stopped, and one only the list stopped takes the stated end (t5v.java `H`, 99-104);
 *    `summary` is kept.
 *  - `background_tasks_changed`: a running record its `tasks` list no longer names is Stopped (not
 *    a `remote_agent`, not one stated foreground), and comes back running if a later list names it.
 *
 * A `run_id` later than the record's (string order, t5v.java `N`, 1900-1913) restarts it; an
 * earlier one is a stale event and is ignored. Events with `parent_tool_use_id` are a subagent's
 * and are skipped (t5v.java 2770: `lauVar.Q`). The shapes are Claude Code 2.1.300's own emitters
 * (`subtype:"task_started",task_id,run_id,tool_use_id,description,…,task_type`; `task_notification`
 * `task_id,run_id,tool_use_id,status,output_file,summary,usage`; `task_updated` `task_id,run_id,
 * patch`; `background_tasks_changed` `tasks:[{task_id,task_type,description,…}]`).
 *
 * The sheet lists shells (`local_bash`) and agents (`local_agent`, `remote_agent`), and a workflow
 * (`…_workflow`) as the app's workflow card does (mt2.java case 3, cs2.java `b`); other kinds
 * (a monitor) are not listed.
 */

export type CcrTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'

export type CcrBackgroundTask = {
  taskId: string
  toolUseId: string | null
  taskType: string | null
  description: string | null
  status: CcrTaskStatus
  startedAt: number | null
  endedAt: number | null
  summary: string | null
  runId: string | null
  isBackgrounded: boolean | null
  /** Stopped because a `background_tasks_changed` stopped naming it (the app's `settledByLevel`). */
  settledByList: boolean
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** tt30.java `i`: the words a task's end is stated in; anything else is null (unknown). */
function endStatus(value: unknown): Exclude<CcrTaskStatus, 'running'> | null {
  switch (value) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'stopped':
    case 'killed':
    case 'cancelled':
      return 'stopped'
    default:
      return null
  }
}

function fresh(taskId: string): CcrBackgroundTask {
  return {
    taskId,
    toolUseId: null,
    taskType: null,
    description: null,
    status: 'running',
    startedAt: null,
    endedAt: null,
    summary: null,
    runId: null,
    isBackgrounded: null,
    settledByList: false
  }
}

/** The record an event with this `run_id` applies to, or null when the event is a stale run's. */
function forRun(task: CcrBackgroundTask, runId: string | null, at: number | null): CcrBackgroundTask | null {
  if (runId === null || runId === task.runId) {
    return task
  }
  if (task.runId === null) {
    return { ...task, runId }
  }
  if (runId < task.runId) {
    return null
  }
  return { ...fresh(task.taskId), toolUseId: task.toolUseId, taskType: task.taskType, description: task.description, startedAt: at, runId }
}

function applyChangedList(tasks: Map<string, CcrBackgroundTask>, list: unknown, at: number | null): void {
  if (!Array.isArray(list)) {
    return
  }
  const named = new Map<string, string | null>()
  for (const entry of list) {
    const id = text(rec(entry)?.task_id)
    if (id) {
      named.set(id, text(rec(entry)?.task_type))
    }
  }
  for (const [id, task] of tasks) {
    if (named.has(id)) {
      if (task.settledByList || (task.taskType === null && named.get(id))) {
        tasks.set(id, {
          ...task,
          taskType: task.taskType ?? named.get(id) ?? null,
          ...(task.settledByList ? { status: 'running' as const, endedAt: null, settledByList: false } : {})
        })
      }
    } else if (task.status === 'running' && task.taskType !== null && task.taskType !== 'remote_agent' && task.isBackgrounded !== false) {
      tasks.set(id, { ...task, status: 'stopped', endedAt: at, settledByList: true })
    }
  }
}

/** Every task the session's events describe, in the order each was first seen. */
export function deriveCcrBackgroundTasks(events: readonly CcrEvent[]): CcrBackgroundTask[] {
  const tasks = new Map<string, CcrBackgroundTask>()
  for (const event of events) {
    const payload = event.payload
    if (payload.type !== 'system' || text(payload.parent_tool_use_id)) {
      continue
    }
    const at = event.createdAt ?? null
    if (payload.subtype === 'background_tasks_changed') {
      applyChangedList(tasks, payload.tasks, at)
      continue
    }
    const taskId = text(payload.task_id)
    if (!taskId || typeof payload.subtype !== 'string' || !payload.subtype.startsWith('task_')) {
      continue
    }
    const held = tasks.get(taskId) ?? { ...fresh(taskId), startedAt: at }
    const task = forRun(held, text(payload.run_id), at)
    if (!task) {
      continue
    }
    const toolUseId = text(payload.tool_use_id) ?? task.toolUseId
    switch (payload.subtype) {
      case 'task_started':
        tasks.set(taskId, {
          ...task,
          toolUseId,
          taskType: text(payload.task_type) ?? task.taskType,
          description: text(payload.description) ?? task.description,
          startedAt: task.startedAt ?? at,
          isBackgrounded: task.isBackgrounded === true ? true : typeof payload.is_backgrounded === 'boolean' ? payload.is_backgrounded : task.isBackgrounded
        })
        break
      case 'task_progress':
        if (task.status === 'running') {
          const placeholder = task.description === null || task.description === taskId
          tasks.set(taskId, { ...task, toolUseId, description: placeholder ? (text(payload.description) ?? task.description) : task.description })
        }
        break
      case 'task_updated': {
        const patch = rec(payload.patch)
        if (!patch) {
          break
        }
        const ended = endStatus(patch.status)
        const status = ended && (task.status === 'running' || task.settledByList) ? ended : task.status
        tasks.set(taskId, {
          ...task,
          status,
          description: text(patch.description) ?? task.description,
          endedAt: status === 'running' ? null : (task.endedAt ?? at),
          // t5v.java 2992: a list-settled record stays so only while no end was stated.
          settledByList: task.settledByList && ended === null
        })
        break
      }
      case 'task_notification': {
        // A record the list settled takes the notification's own end (t5v.java `H`): the list
        // stops naming a task before its notification lands, in that order, on Claude Code 2.1.300.
        const stated = endStatus(payload.status)
        const status = task.status === 'running' ? (stated ?? 'stopped') : task.settledByList && stated ? stated : task.status
        tasks.set(taskId, { ...task, toolUseId, status, endedAt: task.endedAt ?? at, summary: text(payload.summary) ?? task.summary, settledByList: false })
        break
      }
      default:
        break
    }
  }
  return [...tasks.values()]
}

/** cs2.java `b`: the kind a `task_type` lists as; null for a kind the sheet does not list. */
export function ccrTaskKind(taskType: string | null): BackgroundTaskKind | null {
  if (taskType === 'local_bash') {
    return 'shell'
  }
  if (taskType === 'local_agent' || taskType === 'remote_agent') {
    return 'agent'
  }
  return taskType?.endsWith('_workflow') ? 'workflow' : null
}

const STATUS: Record<CcrTaskStatus, BackgroundTaskStatus> = { running: 'running', completed: 'completed', failed: 'failed', stopped: 'stopped' }

/** How many tasks run, as the app's header counts them: `mt2.v` (mt2.java, default case) adds the
 *  running workflows to the running shells and agents, the very rows its sheet lists (y07.java `c`
 *  hands it to the "N running tasks" line, `ccr_workflow_running_tasks`). A monitor, a task the
 *  background list names with no `task_started` loaded, are in neither; a remote agent is in both. */
export function ccrRunningTaskCount(tasks: readonly CcrBackgroundTask[]): number {
  return tasks.filter((task) => task.status === 'running' && ccrTaskKind(task.taskType) !== null).length
}

/** The sheet's rows from the session's tasks: running and finished, each newest first, as the
 *  app's sheet showed them (2026-10-15 screenshot: 3m 44s above 7m 45s above 9m 45s). The title is
 *  the description (rt30.java `h`: blank, or the bare task id, names nothing), else the kind. */
export function ccrBackgroundTaskRows(tasks: readonly CcrBackgroundTask[], now: number): BackgroundTasks {
  const running: BackgroundTask[] = []
  const finished: BackgroundTask[] = []
  for (const task of tasks) {
    const kind = ccrTaskKind(task.taskType)
    if (!kind) {
      continue
    }
    const named = task.description !== null && task.description !== task.taskId ? task.description.trim() : null
    const caption = captionOf(task.summary)
    const row: BackgroundTask = {
      id: task.taskId,
      kind,
      title: named ?? (kind === 'shell' ? 'Shell' : kind === 'agent' ? 'Agent' : 'Workflow'),
      status: STATUS[task.status],
      startedAt: task.startedAt,
      elapsedMs: task.status === 'running' ? elapsedSince(task.startedAt, now) : null,
      ...(task.toolUseId ? { toolUseId: task.toolUseId } : {}),
      ...(caption ? { summary: caption } : {})
    }
    ;(task.status === 'running' ? running : finished).push(row)
  }
  const newest = (key: (task: BackgroundTask) => number) => (a: BackgroundTask, b: BackgroundTask) => key(b) - key(a)
  const ended = new Map(tasks.map((task) => [task.taskId, task.endedAt ?? task.startedAt ?? 0]))
  running.sort(newest((task) => task.startedAt ?? 0))
  finished.sort(newest((task) => ended.get(task.id) ?? 0))
  return { running, finished }
}

/** The subagent's own rows: the events whose `parent_tool_use_id` is its Agent call, decoded as
 *  the chat decodes the lead's (ccr-transcript-decode.ts drops them from the lead's chat). */
export function ccrSubagentMessages(events: readonly CcrEvent[], toolUseId: string): NativeChatMessage[] {
  const rows: NativeChatMessage[] = []
  for (const event of events) {
    const { parent_tool_use_id: parent, ...payload } = event.payload
    if (parent === toolUseId && (payload.type === 'user' || payload.type === 'assistant')) {
      const decoded = decodeCcrEvent({ ...event, payload })
      // Keyed by `eventId` (the decoder's fallback), which the agent's file never carries.
      if (typeof payload.uuid !== 'string' || payload.uuid.length === 0) {
        decoded.forEach(noteStreamRowWithoutUuid)
      }
      rows.push(...decoded)
    }
  }
  return rows
}
