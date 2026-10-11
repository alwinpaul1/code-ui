import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import {
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatBlock
} from '../../../src/shared/native-chat-types'
import { agentTitle, foldWhitespace, readLaunch, readString } from './mobile-background-task-transcript'

// ─── A run of agents in the conversation ────────────────────────────────────
//
// The Claude app draws the calls that launched agents as one row, "Running
// agent ›" with a moving highlight, and a sheet of "Ran agent <description>"
// rows behind it (recordings of 2026-09-24, Claude Code 2.1.281).
//
// The highlight follows the CALL, not the agent: it sweeps while an Agent/Task
// call of the run has no answer yet and the turn making it is live, and stops
// the moment the answer lands. For a background launch that answer is the
// launch result ("Async agent launched successfully"), seconds after the call;
// the agent's own progress is the Background tasks sheet's to show.
//
// Why not the background-task reader's word, as it was until 2026-10-11: the
// row then swept for as long as anything counted the agent as running, and on
// a hand-started tab nothing ever stopped counting it. A background agent
// that finishes while the lead is mid-turn is written only as a
// `queue-operation` and an `attachment`/`queued_command` record, which Orca's
// reader drops; with no beacon and no host roster to stand in, the row kept
// sweeping "Running agent: …" over a finished agent and an ended turn
// ("Running an Agent animation gets stuck", the user, 2026-10-11; 42 of the 67
// background agents of session 0954729d ended that way). The reader's answer
// still reaches the run sheet (`agentsRunning`), which tells an opened
// transcript whether its agent is live.

export type NativeChatAgentRunInputs = {
  /** Agent ids the background-task reader counts as running: the run sheet's
   *  `agentsRunning`, never the row's sweep. */
  runningIds: ReadonlySet<string>
  /** Agent id to the description Claude Code itself gave it
   *  (`confirmedAgentDescriptions`). */
  confirmed: ReadonlyMap<string, string>
  /** Whether the tab's agent is in a turn: a launch still unanswered is
   *  being made while it is, and was abandoned once it is not. */
  agentWorking: boolean
}

/** One agent in the run. `agentId` is set only where the phone KNOWS which
 *  id this call launched; a guess would open another agent's transcript. */
export type NativeChatAgentRunEntry = { title: string; agentId: string | null }

export type NativeChatAgentRunState = {
  /** An Agent/Task call of the run is still being made: it has no answer yet
   *  and the turn is live. What the row sweeps for. */
  running: boolean
  /** The background-task reader counts an agent this run launched as running.
   *  Never drawn on the row (see above); the run sheet hands it to the
   *  transcript it opens. */
  agentsRunning: boolean
  entries: NativeChatAgentRunEntry[]
  /** What the collapsed row names while a call is being made, the way the
   *  Claude app's reads "Running agent: Review: story flow" (2026-10-09): the
   *  first unanswered call the structured lane marks live, else the last agent
   *  call the run's own results show unanswered. Never a call that has its
   *  answer: falling back to the last call named a finished agent while
   *  another ran (review, 2026-10-09). Null while the run is not running, and
   *  where the call names nothing (no description, name or type). */
  subject: string | null
}

/** Claude Code's own names for the tool that launches a subagent. */
const AGENT_TOOLS = new Set(['Agent', 'Task'])

/** Whether a tool name is Claude Code's launcher for a subagent. */
export function isAgentToolName(name: string): boolean {
  return AGENT_TOOLS.has(name)
}

/** True when every call in the run launched a Claude subagent. A run with any
 *  other tool in it keeps the ordinary tool row, and so does Codex, whose
 *  spawn tool the Claude app has never been seen to draw. */
export function isAgentOnlyRun(blocks: readonly NativeChatBlock[]): boolean {
  let calls = 0
  for (const block of blocks) {
    if (isToolCallBlock(block)) {
      if (!AGENT_TOOLS.has(block.name)) {
        return false
      }
      calls += 1
    }
  }
  return calls > 0
}

/** The collapsed row's words while an agent of the run still works. */
export function runningAgentText(subject: string | null): string {
  return subject ? `Running agent: ${subject}` : 'Running agent'
}

/** The agents of a run, read over the WHOLE run: the Agent/Task calls are the
 *  agents, but a launch's answer is read from every result, because Claude Code
 *  writes results in the order they are acknowledged and Orca drops the tool_use
 *  ids, so a background launch's answer can land before an earlier call's. Pairing
 *  by order handed the launch text to the wrong call (a Read) and lost the agent.
 *  Only this run's own results are read, so a run never shows another's agent. */
const isLaunchText = (output: string): boolean =>
  readLaunch({ name: 'Agent', input: null, startedAt: null }, output) !== null

/** Whether an Agent/Task call of the run has no answer yet. Results pair to calls
 *  by order, which a background launch's early answer upsets, so a launch text
 *  sitting in another call's slot counts as an unanswered agent's answer. An
 *  unanswered call that is no agent's (a Read) says nothing about agents. */
function hasUnansweredAgent(blocks: readonly NativeChatBlock[]): boolean {
  let agentsWithoutResult = 0
  let strayLaunches = 0
  for (const pair of pairToolBlocks(blocks)) {
    if (!pair.call) {
      continue
    }
    if (AGENT_TOOLS.has(pair.call.name)) {
      agentsWithoutResult += pair.result ? 0 : 1
    } else if (pair.result && isLaunchText(pair.result.output)) {
      strayLaunches += 1
    }
  }
  return agentsWithoutResult > strayLaunches
}

/** The agent calls of a run (by their index among its Agent/Task calls) that
 *  its results show to be still unanswered, oldest first. A result that names
 *  its call (`callId`) answers that call. One that does not answers the oldest
 *  open call, as `pairToolBlocks` pairs it, which is only certain while one
 *  call is open: with two or more, it may have answered any of them, so none
 *  of those is offered. A call made after it is certain again. */
function unansweredAgentCalls(blocks: readonly NativeChatBlock[]): number[] {
  const open: { agentIndex: number | null; callId: string | undefined; certain: boolean }[] = []
  let agentIndex = 0
  for (const block of blocks) {
    if (isToolCallBlock(block)) {
      open.push({
        agentIndex: AGENT_TOOLS.has(block.name) ? agentIndex++ : null,
        callId: block.callId,
        certain: true
      })
    } else if (isToolResultBlock(block)) {
      if (block.callId !== undefined) {
        const answered = open.findIndex((call) => call.callId === block.callId)
        if (answered !== -1) {
          open.splice(answered, 1)
        }
        continue
      }
      if (open.length > 1) {
        for (const call of open) {
          call.certain = false
        }
      }
      open.shift()
    }
  }
  return open.flatMap((call) => (call.certain && call.agentIndex !== null ? [call.agentIndex] : []))
}

export function agentRunState(
  blocks: readonly NativeChatBlock[],
  inputs: NativeChatAgentRunInputs
): NativeChatAgentRunState {
  const calls: { title: string; description: string | null; live: boolean; named: boolean }[] = []
  const launched: string[] = []
  for (const block of blocks) {
    if (isToolCallBlock(block)) {
      if (!AGENT_TOOLS.has(block.name)) {
        continue
      }
      const description = readString(block.input, 'description')
      calls.push({
        title: agentTitle(block.input),
        description: description ? foldWhitespace(description) : null,
        live: block.state === 'running',
        named: readString(block.input, 'name') !== null || readString(block.input, 'subagent_type') !== null || description !== null
      })
    } else if (isToolResultBlock(block)) {
      const id = readLaunch({ name: 'Agent', input: null, startedAt: null }, block.output)?.id
      if (id) {
        launched.push(id)
      }
    }
  }
  // Only a live turn makes calls: one it left unanswered was abandoned and
  // never sweeps on, a structured call still marked running included.
  const running = inputs.agentWorking && hasUnansweredAgent(blocks)
  const entries = calls.map((call) => ({
    title: call.title,
    agentId:
      launched.find((id) => call.description !== null && inputs.confirmed.get(id) === call.description) ??
      (calls.length === 1 && launched.length === 1 ? launched[0]! : null)
  }))
  const open = running ? unansweredAgentCalls(blocks) : []
  const subjectIndex = open.find((index) => calls[index]!.live) ?? open.at(-1)
  const subjectCall = subjectIndex === undefined ? undefined : calls[subjectIndex]
  return {
    running,
    agentsRunning: launched.some((id) => inputs.runningIds.has(id)),
    entries,
    subject: subjectCall?.named ? subjectCall.title : null
  }
}
