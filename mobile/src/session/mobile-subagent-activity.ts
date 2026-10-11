// ─── What a running subagent is doing, read off its own transcript ──────────
//
// The Claude app's Background tasks sheet titles a running agent with the step
// it is in ("Running cd /private/tmp/…"), its description otherwise, and lists the shells its
// subagents started as rows of their own ("Shell  1m 20s"). Nothing on the
// session-tab snapshot carries either (docs/subagent-task-visibility.md):
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

import {
  describeActiveToolCall,
  formatActiveToolLabel,
  isCommandToolName
} from '../../../src/shared/native-chat-tool-activity'
import { mcpToolIdentity } from '../../../src/shared/native-chat-tool-identity'
import {
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatMessage,
  type NativeChatToolCallBlock
} from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks, type BackgroundTask, type BackgroundTasks } from './mobile-background-tasks'
import { COUNT_RETIRE_GRACE_MS, shellsOutsideLead, type HeldShellCount } from './mobile-background-task-footer'
import { foldWhitespace, readString } from './mobile-background-task-transcript'
import { subagentTranscriptTarget, type SubagentTranscriptTarget } from './mobile-subagent-transcript'

/** How many running agents the sheet reads at once. Each is one host
 *  subscription tailing one file; past six the sheet is a scroll anyway, and
 *  the agents below keep their description, as before. */
export const SUBAGENT_WATCH_CAP = 6

/** The words a running agent's row draws for one tool call: "Running <first
 *  line of the command>" for a shell call, else the chat's own running-call
 *  wording ("Running Read foo.ts", `formatActiveToolLabel`), with an MCP
 *  tool's own name and no JSON preview. */
export function subagentStepLabel(call: NativeChatToolCallBlock): string {
  if (isCommandToolName(call.name)) {
    const firstLine = readString(call.input, 'command')
      ?.split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0)
    if (firstLine) {
      return `Running ${foldWhitespace(firstLine)}`
    }
  }
  const descriptor = describeActiveToolCall(call)
  const toolName = mcpToolIdentity(call.name)?.tool ?? descriptor.toolName
  // A tool with no plain argument previews its input as JSON
  // (`{"task_id":"bnj50z9e4"}` for a TaskStop); a title says the tool alone.
  const preview = /^[[{]/.test(descriptor.preview) ? '' : descriptor.preview
  return formatActiveToolLabel({ ...descriptor, toolName, preview, key: preview ? 'runningNamedPreview' : 'runningNamed' })
}

/** The agent's tool call still waiting for its result, as a row title; null
 *  while none is in flight (before its first call, between calls, after its
 *  hand-back). The row then reads the agent's description, as Claude Code's own
 *  panel and the Claude app do: on 2026-10-11 the sheet titled three running
 *  agents "Running cd /private/tmp/…", calls that had answered minutes before,
 *  and they read as finished work.
 *
 *  Orca's transcript rows carry no id on a result, so calls and results pair
 *  first in, first out (`pairToolBlocks`): walking back from the end, each
 *  result answers the nearest unanswered call before it, and the newest call
 *  left over is the one in flight. A result whose call sits above the loaded
 *  window answers nothing here. */
export function subagentStepInFlight(messages: readonly NativeChatMessage[]): string | null {
  let unclaimedResults = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const blocks = messages[index]!.blocks
    for (let at = blocks.length - 1; at >= 0; at -= 1) {
      const block = blocks[at]!
      if (isToolResultBlock(block)) {
        unclaimedResults += 1
      } else if (isToolCallBlock(block)) {
        if (unclaimedResults === 0) {
          return subagentStepLabel(block)
        }
        unclaimedResults -= 1
      }
    }
  }
  return null
}

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
}

/** The sheet's tasks with each read agent's in-flight step on its row and the
 *  shells its transcript shows as rows of their own: running ones right
 *  under their agent, finished ones at the head of Finished. With no feed it
 *  returns `tasks` itself. Whether a row takes a Stop is decided after, by
 *  what Claude's own Background dialog can select (terminal-background-task-stops.ts):
 *  it lists a subagent's shells beside the lead's. */
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
    const step = subagentStepInFlight(messages)
    running.push(step ? { ...task, latestStep: step } : task)
    const shells = subagentShells(messages, context)
    for (const shell of shells.running) {
      if (!listed.has(shell.id)) {
        listed.add(shell.id)
        running.push(shell)
        shellRows.push(shell)
      }
    }
    for (const shell of shells.finished) {
      if (!listed.has(shell.id)) {
        listed.add(shell.id)
        finishedShells.push(shell)
      }
    }
  }
  if (shellRows.length === 0 && finishedShells.length === 0 && running.every((task, index) => task === tasks.running[index])) {
    return tasks
  }
  const retired = retiredByFooter(tasks, shellRows, context)
  const keptRunning = running.filter((task) => !retired.has(task.id))
  const retiredRows = shellRows
    .filter((task) => retired.has(task.id))
    .map((task): BackgroundTask => ({ ...task, status: 'finished', elapsedMs: null }))
    .toReversed()
  const stillRunning = shellRows.length - retired.size
  const { shellsInSubagents, ...rest } = tasks
  const unlisted = (shellsInSubagents ?? 0) - stillRunning
  return {
    ...rest,
    running: keptRunning,
    finished: [...retiredRows, ...finishedShells, ...tasks.finished],
    ...(unlisted > 0 ? { shellsInSubagents: unlisted } : {})
  }
}

/** One subagent's shells, judged by its own transcript (launches, TaskStop
 *  answers), by the lead's Stop-hook list, and by the ids the lead's status
 *  line reports finished. */
function subagentShells(messages: readonly NativeChatMessage[], context: SubagentActivityContext): BackgroundTasks {
  const stop = context.stopRunning ?? null
  const derived = deriveBackgroundTasks(messages, context.now, null, {
    runningTaskIds: stop?.ids ?? null,
    runningTaskIdsAt: stop?.at ?? null,
    ...(context.finishedTaskIds ? { finishedTaskIds: context.finishedTaskIds } : {})
  })
  const shell = (task: BackgroundTask) => task.kind === 'shell'
  return { running: derived.running.filter(shell), finished: derived.finished.filter(shell) }
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
