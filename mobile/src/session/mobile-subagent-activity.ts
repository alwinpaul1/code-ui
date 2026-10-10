// ─── What a running subagent is doing, read off its own transcript ──────────
//
// The Claude app's Background tasks sheet titles each running agent with its
// latest step ("Running cd /private/tmp/…") and lists the shells its
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
// isMeta record, so the completion never arrives. A shell is therefore
// retired by what does arrive: a TaskStop in the subagent's transcript, the
// lead's Stop-hook `run=` list (it names every shell in the process) once it
// postdates the launch, or the agent's footer counting fewer shells beyond
// the lead's than are listed (the oldest go first, as the lead's own fit does,
// `mobile-background-task-footer.ts`). A shell that ends with none of those
// keeps its row until its agent finishes, when the row leaves with the read.

import {
  describeActiveToolCall,
  formatActiveToolLabel,
  isCommandToolName
} from '../../../src/shared/native-chat-tool-activity'
import { mcpToolIdentity } from '../../../src/shared/native-chat-tool-identity'
import { isToolCallBlock, type NativeChatMessage, type NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks, type BackgroundTask, type BackgroundTasks } from './mobile-background-tasks'
import { COUNT_RETIRE_GRACE_MS, shellsOutsideLead } from './mobile-background-task-footer'
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

/** The newest tool call in the transcript, as a row title; null before the
 *  agent has made one. */
export function subagentLatestStep(messages: readonly NativeChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const blocks = messages[index]!.blocks
    for (let at = blocks.length - 1; at >= 0; at -= 1) {
      const block = blocks[at]!
      if (isToolCallBlock(block)) {
        return subagentStepLabel(block)
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
  /** The lead's last Stop-hook `run=` and when it came: every running task in
   *  the process, a subagent's shells included. */
  stopRunning?: { ids: readonly string[]; at: number | null } | null
}

/** The sheet's tasks with each read agent's latest step on its row and the
 *  shells its transcript shows as rows of their own: running ones right
 *  under their agent, finished ones at the head of Finished. With no feed it
 *  returns `tasks` itself. A shell gets no Stop: a terminal tab has no stop
 *  path at all, and the structured lane, which has one, never comes here. */
export function mergeSubagentActivity(
  tasks: BackgroundTasks,
  feeds: ReadonlyMap<string, readonly NativeChatMessage[]>,
  context: SubagentActivityContext
): BackgroundTasks {
  if (feeds.size === 0) {
    return tasks
  }
  const { now } = context
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
    const step = subagentLatestStep(messages)
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
  const room = footerRoom(tasks, context.liveShellCount ?? null)
  const retired = room === null ? new Set<string>() : surplusShells(shellRows, room, now)
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
 *  answers) and by the lead's Stop-hook list. */
function subagentShells(messages: readonly NativeChatMessage[], context: SubagentActivityContext): BackgroundTasks {
  const stop = context.stopRunning ?? null
  const derived = deriveBackgroundTasks(messages, context.now, null, {
    runningTaskIds: stop?.ids ?? null,
    runningTaskIdsAt: stop?.at ?? null
  })
  const shell = (task: BackgroundTask) => task.kind === 'shell'
  const own = (task: BackgroundTask): BackgroundTask => ({ ...task, stoppable: false })
  return { running: derived.running.filter(shell).map(own), finished: derived.finished.filter(shell).map(own) }
}

/** How many shells the footer counts beyond the lead's own, or null when it
 *  cannot say (off screen, or a monitor runs and the pill's wording is
 *  unknown). */
function footerRoom(tasks: BackgroundTasks, live: number | null): number | null {
  if (live === null || tasks.running.some((task) => task.kind === 'monitor')) {
    return null
  }
  return shellsOutsideLead(tasks, live)
}

/** The oldest listed subagent shells beyond what the footer counts, never one
 *  launched within the grace (the footer may not have been re-read since). */
function surplusShells(rows: readonly BackgroundTask[], room: number, now: number): Set<string> {
  let surplus = rows.length - room
  const retired = new Set<string>()
  const oldestFirst = [...rows].sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0))
  for (const task of oldestFirst) {
    if (surplus <= 0) {
      break
    }
    if (task.startedAt === null || now - task.startedAt >= COUNT_RETIRE_GRACE_MS) {
      retired.add(task.id)
      surplus -= 1
    }
  }
  return retired
}
