// ─── What a running subagent is doing, read off its own transcript ──────────
//
// The Claude app's Background tasks sheet lists the shells a running agent
// started as rows of their own ("Shell  1m 20s"), and titles the agent itself
// with its description, whatever call it is in (the user's screenshots of
// 2026-10-11; until then this module put the agent's unanswered call on the
// row, "Running cd "/Users/…/worktrees/ag…", for the minutes a gate run takes).
// Nothing on the session-tab snapshot carries the shells (docs/subagent-task-visibility.md):
// Orca keeps a subagent's tool activity off the lead's status on purpose. The
// subagent's own transcript has both, and stock Orca already serves it to the
// phone (`nativeChat.subscribe` with `agent-<id>`, `mobile-subagent-transcript.ts`).
// So while the sheet is open the phone reads each running agent's file
// (`MobileSubagentActivityFeeds.tsx`) and this module folds what it holds
// into the sheet's rows. Pure: `now` is the only clock.
//
// What the transcript cannot say (Claude Code 2.1.296, Orca 1.4.224, verified
// 2026-10-10 against fixtures/claude-subagent-transcripts-2.1.296.ts): a
// subagent shell's `<task-notification>` is written to the SUBAGENT's file as
// an `isMeta` user record, and Orca's reader keeps only the tool results of an
// isMeta record (an `attachment` record while the subagent is busy, written
// only when its current tool call returns), and Orca's reader decodes
// neither, so the completion never arrives through the read. A shell is
// therefore retired by what does arrive: the lead's status-line `done=` ids
// (Claude Code queues every task's notification in the LEAD's transcript as a
// `queue-operation` the moment it ends, whoever launched it, and the status
// line beacons it on its next tick; verified 2026-10-10,
// mobile-subagent-shell-finish.test.ts), a TaskStop in the subagent's
// transcript, the lead's Stop-hook `run=` list (it names every shell in the
// process) once it postdates the launch, or the agent's footer counting fewer
// shells beyond the lead's than are listed (the oldest go first, as the lead's
// own fit does, `mobile-background-task-footer.ts`; its zero is the mode row's
// "(shift+tab to cycle)" hint with no pill, `claude-footer-shell-count.ts`). A
// shell that ends with none of those keeps its row until its agent finishes,
// when the row leaves with the read.

import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks, type BackgroundTask, type BackgroundTasks } from './mobile-background-tasks'
import { COUNT_RETIRE_GRACE_MS, shellsOutsideLead, type HeldShellCount } from './mobile-background-task-footer'
import { readTaskEvidence } from './mobile-background-task-evidence'
import { isTeammateLifecycleId, type RosterRow } from './mobile-background-task-roster'
import { subagentTranscriptTarget, type SubagentTranscriptTarget } from './mobile-subagent-transcript'

/** How many running agents the sheet reads at once. Each is one host
 *  subscription tailing one file; past six the sheet is a scroll anyway, and
 *  the agents below keep their description, as before. */
export const SUBAGENT_WATCH_CAP = 6

/** How long after its launch an agent a subagent started may be missing from
 *  the host's roster before it is called finished: the tab snapshot that
 *  carries its new row comes after the transcript line that launched it. */
const NESTED_ROSTER_GRACE_MS = 30_000

/** The running Claude subagents whose transcripts the open sheet reads, at
 *  most `SUBAGENT_WATCH_CAP`, in the sheet's order. A Codex tab, a shell, a
 *  placeholder row: none. */
export function subagentWatchTargets(args: {
  agent: string | null
  running: readonly BackgroundTask[]
  parentTranscriptPath: string | null
}): SubagentTranscriptTarget[] {
  const targets: SubagentTranscriptTarget[] = []
  for (const task of args.running) {
    if (targets.length >= SUBAGENT_WATCH_CAP) {
      break
    }
    if (task.status !== 'running') {
      continue
    }
    const target = subagentTranscriptTarget({ agent: args.agent, task, parentTranscriptPath: args.parentTranscriptPath })
    if (target) {
      targets.push(target)
    }
  }
  return targets
}

export type SubagentActivityContext = {
  now: number
  /** The agent's footer count of shells, read off the screen; null or absent
   *  when it is not on screen. */
  liveShellCount?: number | null
  /** The last footer count, kept while the footer is off screen (a dialog
   *  over it): it still caps the shells launched before it was read. */
  heldShellCount?: HeldShellCount | null
  /** The lead's last Stop-hook `run=` and when it came: every running task in
   *  the process, a subagent's shells included. */
  stopRunning?: { ids: readonly string[]; at: number | null } | null
  /** Task ids the lead's status line reports finished (`done=`, remembered
   *  for the session; `use-active-tab-finished-task-ids.ts`). A subagent
   *  shell's completion is queued in the LEAD's transcript as a
   *  `queue-operation` record the moment the shell ends, whoever launched it
   *  (Claude Code 2.1.296), and the status line beacons its id within one
   *  heartbeat. The footer's zero says it too, but only while the footer is
   *  on screen and wide enough to draw its hint. */
  finishedTaskIds?: readonly string[]
  /** The host's roster (`agentStatus.subagents`): what says whether an agent a
   *  read subagent launched is still running. Null or absent lists no such
   *  agent, since its end is written to its parent as a record Orca's reader
   *  drops, and nothing else could ever end its row. */
  hostSubagents?: readonly RosterRow[] | null
}

/** The sheet's tasks with the shells and agents each read agent's transcript
 *  shows launched as rows of their own:
 *  running ones right under their agent, finished ones at the head of
 *  Finished. An agent a subagent launched ("Opus regression review of outbox
 *  drainer", started by "Reliable sends, never dropped" in session 0954729d)
 *  is listed the way the Claude app lists it: running while the host's roster
 *  holds its row, finished once the roster drops it. With no feed it
 *  returns `tasks` itself. */
export function mergeSubagentActivity(
  tasks: BackgroundTasks,
  feeds: ReadonlyMap<string, readonly NativeChatMessage[]>,
  context: SubagentActivityContext
): BackgroundTasks {
  if (feeds.size === 0) {
    return tasks
  }
  const listed = new Set([...tasks.running, ...tasks.finished].map((task) => task.id))
  const running: BackgroundTask[] = []
  const shellRows: BackgroundTask[] = []
  const finishedShells: BackgroundTask[] = []
  for (const task of tasks.running) {
    const messages = task.kind === 'agent' ? feeds.get(task.id) : undefined
    if (messages === undefined) {
      running.push(task)
      continue
    }
    running.push(task)
    const shells = subagentWork(messages, context)
    for (const shell of shells.running) {
      if (!listed.has(shell.id)) {
        listed.add(shell.id)
        running.push(shell)
        if (shell.kind === 'shell') {
          shellRows.push(shell)
        }
      }
    }
    for (const shell of shells.finished) {
      if (!listed.has(shell.id)) {
        listed.add(shell.id)
        finishedShells.push(shell)
      }
    }
  }
  if (
    running.length === tasks.running.length &&
    finishedShells.length === 0 &&
    running.every((task, index) => task === tasks.running[index])
  ) {
    return tasks
  }
  const retired = retiredByFooter(tasks, shellRows, context)
  const keptRunning = running.filter((task) => !retired.has(task.id))
  const retiredRows = shellRows
    .filter((task) => retired.has(task.id))
    .map((task): BackgroundTask => ({ ...task, status: 'finished', elapsedMs: null }))
    .toReversed()
  return {
    ...tasks,
    running: keptRunning,
    finished: [...retiredRows, ...finishedShells, ...tasks.finished]
  }
}

/** One subagent's shells, judged by its own transcript (launches, TaskStop
 *  answers, a read of an output file's end trailer), by the lead's Stop-hook
 *  list, and by the ids the lead's status line reports finished; and, given
 *  the host's roster, the agents it launched, judged by that roster alone. */
function subagentWork(messages: readonly NativeChatMessage[], context: SubagentActivityContext): BackgroundTasks {
  const stop = context.stopRunning ?? null
  const options = {
    runningTaskIds: stop?.ids ?? null,
    runningTaskIdsAt: stop?.at ?? null,
    ...(context.finishedTaskIds ? { finishedTaskIds: context.finishedTaskIds } : {})
  }
  const shell = (task: BackgroundTask) => task.kind === 'shell'
  const derived = deriveBackgroundTasks(messages, context.now, null, options)
  const roster = context.hostSubagents ?? null
  if (roster === null) {
    return { running: derived.running.filter(shell), finished: derived.finished.filter(shell) }
  }
  // The same transcript read against the roster, for its agents only. The
  // roster stands in as a `working` pane with no start, so no shell rule
  // reads it; an empty provenance keeps the roster's other rows (the lead's
  // agents, other reviewers) off this agent's list, and only an agent this
  // transcript launched is taken, so a teammate row the provenance would let
  // through is not.
  const launched = new Set(readTaskEvidence(messages).ownAgentIds)
  const judged = deriveBackgroundTasks(messages, context.now, { state: 'working', subagents: [...roster] }, {
    ...options,
    agentProvenance: { ownAgentIds: [], preexistingAgentIds: [] }
  })
  // A teammate's id (`a<name>-<hex>`) is never a subagent's: Claude Code
  // refuses a teammate spawned from inside one, and a SendMessage to one puts
  // its id in `launched`.
  const nested = (task: BackgroundTask) => task.kind === 'agent' && launched.has(task.id) && !isTeammateLifecycleId(task.id)
  // The roster can lag the transcript: Orca adds the row at SubagentStart and
  // the phone gets it on the next tab snapshot. A launch the roster does not
  // list yet is not called finished in that gap (review of 59494020b: the row
  // read "Completed" at launch, and was kept so).
  const settled = (task: BackgroundTask) => task.startedAt === null || context.now - task.startedAt >= NESTED_ROSTER_GRACE_MS
  return {
    running: [...derived.running.filter(shell), ...judged.running.filter(nested)],
    finished: [...derived.finished.filter(shell), ...judged.finished.filter((task) => nested(task) && settled(task))]
  }
}

/** The listed subagent shells the footer says are over: beyond what it counts
 *  outside the lead, the oldest first. A live reading judges every shell
 *  launched before the grace; a held one (the footer under a dialog) only the
 *  shells launched before it was read, so a shell retired by the footer is not
 *  put back to running while a dialog covers it. Nothing while a monitor runs
 *  (the pill's wording is then unknown) or with no reading at all. A zero
 *  (no pill, `claude-footer-shell-count.ts`) retires every graced row. */
function retiredByFooter(
  tasks: BackgroundTasks,
  rows: readonly BackgroundTask[],
  context: SubagentActivityContext
): Set<string> {
  const live = context.liveShellCount ?? null
  const held = context.heldShellCount ?? null
  if (tasks.running.some((task) => task.kind === 'monitor')) {
    return new Set()
  }
  const now = context.now
  if (live !== null) {
    const graced = (task: BackgroundTask) => task.startedAt === null || now - task.startedAt >= COUNT_RETIRE_GRACE_MS
    return oldestBeyond(rows, graced, rows.length - shellsOutsideLead(tasks, live))
  }
  if (held === null) {
    return new Set()
  }
  const readBefore = (task: BackgroundTask) => task.startedAt === null || task.startedAt <= held.at - COUNT_RETIRE_GRACE_MS
  return oldestBeyond(rows, readBefore, rows.filter(readBefore).length - shellsOutsideLead(tasks, held.count))
}

/** Up to `surplus` of the retirable rows, oldest launch first. */
function oldestBeyond(rows: readonly BackgroundTask[], retirable: (task: BackgroundTask) => boolean, surplus: number): Set<string> {
  const oldestFirst = rows.filter(retirable).sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0))
  return new Set(oldestFirst.slice(0, Math.max(0, surplus)).map((task) => task.id))
}
