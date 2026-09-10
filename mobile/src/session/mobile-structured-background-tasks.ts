// ─── Background tasks a STRUCTURED tab reads off the wire ───────────────────
// The other reader (`mobile-background-tasks.ts`) mines the transcript, which
// is all a terminal-driven tab has. A structured tab has something better: the
// host publishes the provider's own roster on `agentSession.subscribe`
// (Orca #18757, #18807, #19346, #19311), so the phone reads what the provider
// says is running instead of inferring it from tool output.
//
// Three states, and the difference between the first two matters:
//   `undefined` — the host has never reported a roster (an older host, or a
//                 session that has never had background work). Fall back to the
//                 transcript reader; that is what this app did before the wire.
//   `null`      — the host reported one and then cleared it. Authoritative: the
//                 transcript reader must NOT take over and re-list work the
//                 host has just said is gone.
//   an object   — the live roster, and the whole answer.
//
// Deliberately not merged with the transcript reader. The two speak different
// id spaces (Claude's transcript task ids versus the SDK's task frames), so
// stitching them risks the same task in both the Running and Finished lists.

import type {
  AgentSessionBackgroundTask,
  AgentSessionBackgroundTaskState
} from '../../../src/shared/agent-session-wire'
import {
  backgroundTaskKindLabel,
  type BackgroundTask,
  type BackgroundTaskKind,
  type BackgroundTasks
} from './mobile-background-tasks'

/** The host's roster in the shape the tasks row and sheet already render, or
 *  `null` when the host has said nothing and the transcript reader still owns
 *  this tab. */
export function projectStructuredBackgroundTasks(
  state: AgentSessionBackgroundTaskState | null | undefined,
  now: number
): BackgroundTasks | null {
  if (state === undefined) {
    return null
  }
  if (state === null) {
    return { running: [], finished: [] }
  }
  return {
    running: (state.tasks ?? []).map((task) => liveTask(task, now)),
    finished: (state.settledTasks ?? []).map((task) => settledTask(task))
  }
}

/** Whether the host offers to stop one named task. Absent means it does not:
 *  a stop this host would refuse is worse than no button. */
export function structuredBackgroundTaskStopSupported(
  state: AgentSessionBackgroundTaskState | null | undefined
): boolean {
  return state?.supportsTaskStop === true
}

function liveTask(task: AgentSessionBackgroundTask, now: number): BackgroundTask {
  const startedAt = typeof task.startedAt === 'number' ? task.startedAt : null
  return {
    ...identity(task),
    status: 'running',
    startedAt,
    elapsedMs: startedAt === null ? null : Math.max(0, now - startedAt)
  }
}

function settledTask(task: AgentSessionBackgroundTask): BackgroundTask {
  return {
    ...identity(task),
    // Only an explicitly bad end is drawn as a failure; every other terminal
    // state is reported as merely finished rather than guessed into an alarm.
    status: task.state === 'blocked' ? 'failed' : 'completed',
    startedAt: typeof task.startedAt === 'number' ? task.startedAt : null,
    elapsedMs: null
  }
}

function identity(task: AgentSessionBackgroundTask): {
  id: string
  kind: BackgroundTaskKind
  title: string
} {
  const kind = localKind(task.kind)
  const named = task.description?.trim() || task.name?.trim()
  return { id: task.id, kind, title: named || backgroundTaskKindLabel(kind) }
}

function localKind(kind: AgentSessionBackgroundTask['kind']): BackgroundTaskKind {
  switch (kind) {
    case 'agent':
      return 'agent'
    case 'command':
      return 'shell'
    case 'monitor':
      return 'monitor'
    case 'workflow':
      return 'workflow'
    case 'unknown':
      return 'unknown'
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}
