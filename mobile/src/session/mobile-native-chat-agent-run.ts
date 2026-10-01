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
// agent ›" with a moving highlight while any of them still runs, and a sheet
// of "Ran agent <description>" rows behind it (recordings of 2026-09-24,
// Claude Code 2.1.281). Whether an agent still runs is not in the run itself:
// a background launch returns at once. It is the background-task reader's
// answer, which the chat hands every row (`NativeChatAgentRunsContext`).

export type NativeChatAgentRunInputs = {
  /** Agent ids the background-task reader counts as running. */
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

export type NativeChatAgentRunState = { running: boolean; entries: NativeChatAgentRunEntry[] }

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

export function agentRunState(
  blocks: readonly NativeChatBlock[],
  inputs: NativeChatAgentRunInputs
): NativeChatAgentRunState {
  const calls: { title: string; description: string | null; live: boolean }[] = []
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
        live: block.state === 'running'
      })
    } else if (isToolResultBlock(block)) {
      const id = readLaunch({ name: 'Agent', input: null, startedAt: null }, block.output)?.id
      if (id) {
        launched.push(id)
      }
    }
  }
  const unanswered = hasUnansweredAgent(blocks)
  const running =
    calls.some((call) => call.live) ||
    (unanswered && inputs.agentWorking) ||
    launched.some((id) => inputs.runningIds.has(id))
  const entries = calls.map((call) => ({
    title: call.title,
    agentId:
      launched.find((id) => call.description !== null && inputs.confirmed.get(id) === call.description) ??
      (calls.length === 1 && launched.length === 1 ? launched[0]! : null)
  }))
  return { running, entries }
}
