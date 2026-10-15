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
//
// A background agent does sweep the row while it runs, as the Claude app's
// does ("Running agent: Fix status line usage figures", 2026-10-11, Claude
// Code 2.1.296), but only on the word of a source that will also say when it
// stops (`liveTaskIds`): the host's own roster, Orca's per-subagent hook rows.
// Never on the transcript reader's alone, which is what stuck.

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
  /** Task ids (agents and shells) a source that can also retire them says are
   *  running: the host's structured roster, or for an agent Orca's live
   *  subagent row (`rowLiveTaskIds`). What a finished launch's row sweeps for.
   *  Absent: none. */
  liveTaskIds?: ReadonlySet<string>
}

/** One agent in the run. `agentId` is set only where the phone KNOWS which
 *  id this call launched; a guess would open another agent's transcript. */
export type NativeChatAgentRunEntry = { title: string; agentId: string | null }

export type NativeChatAgentRunState = {
  /** An Agent/Task call of the run is still being made (no answer yet and
   *  the turn is live), or an agent it launched is in `liveTaskIds`. What the
   *  row sweeps for. */
  running: boolean
  /** The background-task reader counts an agent this run launched as running.
   *  Never drawn on the row (see above); the run sheet hands it to the
   *  transcript it opens. */
  agentsRunning: boolean
  entries: NativeChatAgentRunEntry[]
  /** What the collapsed row names: "Running agent: <subject>". The Claude app
   *  names an agent only from the background task its call launched (the
   *  task's description, `cs2.d`), so only while no call of the run is still
   *  being made and a launched agent is known to run: the first such agent, by
   *  the description its call gave. Null while a call is being made (the app's
   *  bare "Running agent ›", 2026-10-16), when the run is not running, and for
   *  an agent whose call gave no description (the app's task is then named by
   *  its id, and the app draws the bare verb). The rule's lines are below. */
  subject: string | null
  /** The leading icon of the running row: `agent` (one diamond, the app's
   *  agentSimple) while one agent the run launched runs in the background,
   *  `agents` (two, agentsSimple) while several do; null while a call is still
   *  being made, and on "Ran N agents". */
  icon: AgentRunIcon | null
}

/** The Claude app's icons for a running group (cds_icon_symbols.ttf: agentSimple
 *  U+E11B one diamond, agentsSimple U+E11C two). */
export type AgentRunIcon = 'agent' | 'agents'

// The Claude app's rule for a running group's row (com.anthropic.claude
// 1.261013.20, jadx, read 2026-10-16; `ei4.b`, single-ei4/.../ei4.java:930-1023):
//  - a call of the run still Pending (`npz.t`, no answer yet): the row is the
//    LAST pending call's verb (`bw30.f`, "Running agent"), with NO icon
//    (`y85VarI = null` off the `z3` path, :978-980);
//  - else, the background tasks the run's calls launched that are still Running
//    (`cs2.f == 1`, built in `ay8` method #8, classes3 dex 0x141-0x182): the row
//    is the FIRST one's call (`z69.v0`, firstOrNull), drawn running, with the
//    icon of the tasks' kinds: all shells `commandLinePrompt`, one task
//    `rt30.i(kind)` (an agent: agentSimple), several `agentsSimple`
//    (:946-976, rt30.java:473-486);
//  - else the summary ("Ran 5 agents"), no icon (`i430.a` has no icon slot).
// The words: `ei4.f` (:1309-1331) draws "Running agent: %1$s"
// (`ccr_verb_running_agent_described`) when the map from the call's tool-use id
// to its task's description holds one, else the bare verb. That map (ay8 #8,
// 0x1a0-0x1f4) holds only Agent tasks whose description is not their task id,
// and only under the `ccr_transcript_turn_merge` flag (`su8.I3`, su8.java:759),
// which the app's recordings of 2026-10-09 and 2026-10-11 show on. A call still
// being made has no task record for the map to hold: the user's screenshot of
// 2026-10-16, a bare "Running agent ›" over an Agent call waiting on its answer.
// Code UI drew "Running agent: <the call's description>" with the diamonds there
// until 2026-10-16.

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
export const isLaunchText = (output: string): boolean =>
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
  const calls: { title: string; description: string | null }[] = []
  const launched: string[] = []
  for (const block of blocks) {
    if (isToolCallBlock(block)) {
      if (!AGENT_TOOLS.has(block.name)) {
        continue
      }
      const description = readString(block.input, 'description')
      calls.push({
        title: agentTitle(block.input),
        description: description ? foldWhitespace(description) : null
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
  const launching = inputs.agentWorking && hasUnansweredAgent(blocks)
  const live = inputs.liveTaskIds
  const launchedLive = live !== undefined && launched.some((id) => live.has(id))
  const running = launching || launchedLive
  const entries = calls.map((call) => ({
    title: call.title,
    agentId:
      launched.find((id) => call.description !== null && inputs.confirmed.get(id) === call.description) ??
      (calls.length === 1 && launched.length === 1 ? launched[0]! : null)
  }))
  // A call being made names nothing and draws no icon. Else the first agent of
  // the run known (by its own id) to still run names the row. One whose id the
  // phone cannot tie to its call names nothing: a guess could name a finished
  // agent.
  const background = !launching && launchedLive
  const liveIndex = background
    ? entries.findIndex((entry) => entry.agentId !== null && live.has(entry.agentId))
    : -1
  const liveCount = background ? new Set(launched.filter((id) => live.has(id))).size : 0
  return {
    running,
    agentsRunning: launched.some((id) => inputs.runningIds.has(id)),
    entries,
    subject: liveIndex === -1 ? null : calls[liveIndex]!.description,
    icon: liveCount === 0 ? null : liveCount === 1 ? 'agent' : 'agents'
  }
}
