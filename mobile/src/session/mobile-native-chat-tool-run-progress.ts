import { pairToolBlocks, type NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import type { NativeChatBlock, NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import { readLaunch } from './mobile-background-task-transcript'
import {
  agentRunState,
  isAgentToolName,
  isLaunchText,
  type NativeChatAgentRunInputs
} from './mobile-native-chat-agent-run'

// ─── Whether a run's collapsed row is still running ─────────────────────────
//
// The Claude app's row for a run with work still going is in the present
// tense, with its shimmer: "Running agent: Fix status line usage figures ›"
// while a background agent the run launched works, "Running ›" (a terminal
// glyph) while a command runs, in the foreground or moved to the background
// (2026-10-11 recording, Claude Code 2.1.296). Code UI drew both in the past
// tense: "Ran 1 agent", and "Ran Run the full gate on main", the past-tense
// verb glued onto a command's own imperative description.
//
// The structured lane hands a run its live call (`activeCall`). A transcript
// tab has no per-call state, so this reads it from the run itself, and every
// way in is one that is also certain to end:
// - a call with no answer, only while the turn is live (`agentWorking`): the
//   turn's end settles it, as it does an unanswered Agent call;
// - a background launch, only while a source that will also retire it says it
//   runs (`liveTaskIds`): never the transcript reader's word alone, which kept
//   a finished agent sweeping for good ("Running an Agent animation gets
//   stuck", 2026-10-11, mobile-native-chat-agent-run.ts).

export type ToolRunProgress =
  | { kind: 'agent'; subject: string | null }
  | { kind: 'call'; call: NativeChatToolCallBlock }
  | null

/** A call whose order-paired slot is empty, or holds an agent's launch text. */
function looksOpen(pair: NativeChatToolPair): pair is NativeChatToolPair & { call: NativeChatToolCallBlock } {
  return pair.call !== undefined && (pair.result === undefined || isLaunchText(pair.result.output))
}

/** The newest non-agent call still without its answer, or null. A transcript's
 *  results name no call and pair by order, and Claude Code writes them in the
 *  order they are acknowledged, so slots are not trusted: a background agent's
 *  launch text can sit in an earlier Read's slot while the Read's own answer
 *  sits in the Agent's (review of cdcee5126). So it counts: a non-agent call is
 *  open only when the run has more calls than answers beyond the agent calls
 *  still unanswered, the balance `hasUnansweredAgent` keeps. */
function openNonAgentCall(pairs: readonly NativeChatToolPair[]): NativeChatToolCallBlock | null {
  let calls = 0
  let answers = 0
  let agentsWithoutAnswer = 0
  let strayLaunches = 0
  for (const pair of pairs) {
    if (pair.result) {
      answers += 1
    }
    if (!pair.call) {
      continue
    }
    calls += 1
    if (isAgentToolName(pair.call.name)) {
      agentsWithoutAnswer += pair.result ? 0 : 1
    } else if (pair.result && isLaunchText(pair.result.output)) {
      strayLaunches += 1
    }
  }
  const agentsOpen = Math.max(0, agentsWithoutAnswer - strayLaunches)
  if (calls - answers - agentsOpen <= 0) {
    return null
  }
  const candidates = pairs.filter(looksOpen).filter((pair) => !isAgentToolName(pair.call.name))
  return candidates.at(-1)?.call ?? null
}

/** The background task a non-agent call's answer says it launched, or null. */
function launchedTaskId(pair: NativeChatToolPair): string | null {
  if (!pair.call || !pair.result) {
    return null
  }
  return readLaunch({ name: pair.call.name, input: pair.call.input, startedAt: null }, pair.result.output)?.id ?? null
}

/** Cheap: whether the run could be running at all, so a run that cannot be
 *  never reads the chat's task state, which changes with every message. */
export function toolRunMayBeRunning(pairs: readonly NativeChatToolPair[]): boolean {
  return pairs.some(
    (pair) =>
      pair.call !== undefined &&
      (isAgentToolName(pair.call.name) || looksOpen(pair) || launchedTaskId(pair) !== null)
  )
}

/** The run's running state, for a run the structured lane gave no live call.
 *  An agent still being launched or still running names the row first (row 17
 *  of docs/claude-app-parity.md: a run holding an agent reads "Running agent"
 *  whatever else it did); then the newest command or tool call still open
 *  while the turn works; then a shell it moved to the background that still
 *  runs. Null when nothing is known to run. */
export function toolRunProgress(
  blocks: readonly NativeChatBlock[],
  inputs: NativeChatAgentRunInputs,
  /** Whether this run is in the newest reply of the chat. `agentWorking` is
   *  the tab's, not the run's: an interrupted turn leaves its call with no
   *  answer, and read by the tab's state alone that call swept again in every
   *  later turn (review of cdcee5126). */
  { inNewestReply }: { inNewestReply: boolean }
): ToolRunProgress {
  const pairs = pairToolBlocks(blocks)
  if (pairs.some((pair) => pair.call !== undefined && isAgentToolName(pair.call.name))) {
    const agents = agentRunState(blocks, inputs)
    if (agents.running) {
      return { kind: 'agent', subject: agents.subject }
    }
  }
  const others = pairs.filter((pair) => pair.call !== undefined && !isAgentToolName(pair.call.name))
  if (inputs.agentWorking && inNewestReply) {
    const open = openNonAgentCall(pairs)
    // Stateless calls only: a call the structured lane marks is its `activeCall`'s.
    if (open && open.state == null) {
      return { kind: 'call', call: open }
    }
  }
  const live = inputs.liveTaskIds
  if (live && live.size > 0) {
    for (const pair of others) {
      const id = launchedTaskId(pair)
      if (id !== null && live.has(id) && pair.call) {
        return { kind: 'call', call: pair.call }
      }
    }
  }
  return null
}
