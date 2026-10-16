import type {
  NativeChatMessage,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import { pairToolBlocks, type NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { formatClaudeElapsed } from './claude-working-footer-stats'
import { readLaunch } from './mobile-background-task-transcript'
import { inputsOf } from './claude-live-tool-inputs'
import { claudeToolCategory, TASK_TOOLS } from './claude-live-tool-label'

// The Claude Android app's "live tool row": the working footer's form that names the tool the turn
// is running ("[mark] Running pnpm test  12s ›") in place of the verb and the stats
// (com.anthropic.claude 1.261013.20, jadx, read 2026-10-16). Where each piece comes from, so the
// next release can be re-checked; the label's code is claude-live-tool-label.ts (and
// claude-live-tool-send-message.ts for SendMessage). Paths are under the decompile's `out/sources/defpackage/`
// unless named `single-*` (classes jadx had to be run on alone).
//
//   flag           ro8.java:57, w70.java:31  the row is behind the server flag
//                                    `claudeai_code_live_tool_row` (`su8.r0.j`), read in Q2 below.
//                                    OFF on the user's phone: see CLAUDE_LIVE_TOOL_ROW_ENABLED.
//   which call     zr8.java:917-990 (`su8.h7`, case 17) walking the transcript back from its end,
//                                    past items that draw nothing, to the newest tool group
//                                    (`z59`); a message with visible content after it means no
//                                    group. In it, the newest call still Pending (`npz.t`) that did
//                                    not start background work is `Running` (`p2k`); with none,
//                                    the group's last call is `Held` (`o2k`) unless it started
//                                    background work. Either is the row's call.
//   background     rt8.java:9-70    `startedBackgroundWork`: a call whose result holds a task it
//                                    launched; a Bash with `run_in_background`; a Task/Agent whose
//                                    result says it launched in the background; a failed call never
//   gate           su8.java:6993-7085 `Q2()` builds `ToolGroupMark(group, call, agentDescription,
//                                    header)` (c000.java) only when the session is a Claude Code
//                                    one, the turn is working (`G5`), the flag is on, and there is
//                                    a call; header `Working(turnStartedAtMillis)` (d2k.java) when
//                                    no connection message (`x2()`, su8.java:12179) and no `h3()`
//                                    is up, `AwaitingApproval` (c2k.java) when the call (or one of
//                                    its sub-calls) awaits a permission (`P5`)
//   row            single-y07 y07.java:811-909 `r0x(callId, text, clock, isLoading, middleEllipsis)`
//                                    (r0x.java): text the label below, clock the elapsed time (only
//                                    with `Working`), isLoading = header is `Working`,
//                                    middleEllipsis = `xpz.e(call)` (a path-like tool)
//   clock          y07.java:834-865 whole seconds since `turnStartedAtMillis`, never below 0, shown
//                                    only from 2 s, written by `rt30.k` (rt30.java:492-509), which
//                                    is `zs20.n`'s "15s" / "1m 5s": formatClaudeElapsed
//   label          y07.java:877-905 `ei4.f(call as Pending, agentDescription)`: "Running agent: %1$s"
//                                    (`ccr_verb_running_agent_described`) with a description, else
//                                    `bw30.f(call as Pending)`. With no description, " " + detail is
//                                    appended: for a Bash-like tool (`hqz.e == gqz.x`) its trimmed
//                                    `command` input, or its `description` when the command has a
//                                    newline or is over 60 characters; for others `ei4.g(call)`,
//                                    cut to the file name for a path-like tool (`xpz.g`)
//   verbs          single-bw30 bw30.java:688-881 `bw30.f`, every string the present ("-ing") form,
//                                    because y07 hands it the call with its status set to Pending
//                                    (`opzVar.b(npz.t, ..)`, y07.java:874)
//   detail         single-ei4 ei4.java:1334-1342 `ei4.g`; hqz.java:116-185 `hqz.c`; xpz.java:19-131
//                                    `xpz.a`; xpz.java:279-293 `xpz.h` (a string input, trimmed,
//                                    not empty); xpz.java:273-277 `xpz.g` (after the last / or \)
//   category       hqz.java:273 (`hqz.e`, read in jadx fallback mode: the normal output drops the
//                                    returns) and gqz.java:22-46
//   mark           y07.java:1012-1015 `AwaitingApproval` draws `rq20.z` (WaitingForUser), else
//                                    `d1x.a(call)` (claude-working-mark.ts `workingMarkKindForTool`)
//   count          y07.java:968     "N running tasks" is not drawn while the row shows
//   drawing        single-wm7 wm7.java:70-80 the whole line clips to a 12 dp rounded shape and is
//                                    clickable ("Show details", `generic_show_details`) when it is
//                                    working, is a tool row and has an onClick (y07.java:989-1011:
//                                    it opens that call's details); the 16 dp above and below sit
//                                    inside the touch area. wm7.java:104-108 the mark, then 8 dp.
//                                    wm7.java:241-275: the label with weight 1 (not filling), one
//                                    line, middle ellipsis when path-like (TextOverflow 5) else end
//                                    (2), colour `ad5.x0()`, shimmering while loading (`pq30.g`'s
//                                    last flag, pq30.java:756-764 `hfw.a`); then the clock after
//                                    8 dp in rolling figures (`z530.a`), colour `ad5.y()`; then,
//                                    when clickable, 4 dp and a 16 dp chevron (`fp30.c`,
//                                    fp30.java:93-125: `yu0.Small` = 16 dp, tint `pl7.Q`)
//   swap           wm7.java:109-120 the label row is animated content keyed by the call id
//                                    ("spark line"); not ported, the row changes in place
//
// Not ported, with why:
//   - `agentDescription` (su8.java:7068-7080): an Agent call's live description from the session's
//     background-task record (`j4.u`), only on an `I3` session. Code UI has no such record per
//     call, so an Agent row reads "Running agent " + its `description` input (the app's own path
//     when the record is missing).
//   - `h3()` (su8.java:9153, a flag `z6` cleared at turn end) and `v4`, `M3()`, `T3()`, `y3()`,
//     `A2().L`, `H0() instanceof wna` (su8.java:6996-7004): session states this read did not name;
//     no Code UI state is mapped to them.
//   - git outcomes (`zp30.i`, zp30.java:376-436): only on a COMPLETED Bash with a structured git
//     result the Claude app's server sends; the label is built from the Pending copy, so it never
//     reaches the label, and Code UI's transcript has no such result for the detail.
//   - `opz.i` (hqz.java:442-464): a server-supplied display name for an MCP tool; Code UI reads the
//     tool's own name.
//   - `ls2.c`'s `script` pattern for a Workflow's detail (ls2.java:89-93); `name` and `scriptPath`
//     are read.

/**
 * Whether the working footer may draw the live tool row. FALSE, deliberately: on 2026-10-16 the
 * user's Claude app (1.261013.20) drew "Noodling..." (the verb form) while the Agent tool ran, so
 * the `claudeai_code_live_tool_row` server flag is off for them, and they asked for the footer to
 * match their app. The row is ported and tested whole; flip this when the app is seen drawing it.
 */
export const CLAUDE_LIVE_TOOL_ROW_ENABLED = false

/** `xi6.a(8f, ..)` before the clock (wm7.java:263). */
export const CLAUDE_TOOL_ROW_CLOCK_GAP = 8
/** `xi6.a(4f, ..)` before the chevron (wm7.java:268). */
export const CLAUDE_TOOL_ROW_CHEVRON_GAP = 4
/** `yu0.Small` (yu0.java:5). */
export const CLAUDE_TOOL_ROW_CHEVRON_SIZE = 16
/** `b2t.b(12f)`, the clip the touch ripple takes (wm7.java:80). */
export const CLAUDE_TOOL_ROW_RADIUS = 12
/** The clock is drawn from this many whole seconds (y07.java:857). */
export const CLAUDE_TOOL_ROW_CLOCK_FROM_SECONDS = 2

/** The row's clock at `now`, or null under 2 s or with no start (y07.java:849-865). */
export function claudeLiveToolClock(turnStartedAt: number | null, now: number): string | null {
  if (turnStartedAt === null) {
    return null
  }
  const seconds = Math.max(0, Math.floor((now - turnStartedAt) / 1000))
  return seconds < CLAUDE_TOOL_ROW_CLOCK_FROM_SECONDS ? null : formatClaudeElapsed(seconds)
}

/** `startedBackgroundWork` (rt8.java:9-70). With a result: whether it launched something that keeps
 *  running (the app reads its result's task, `v300.j`; here readLaunch reads the result's wording:
 *  a shell started or moved to the background, an agent launched, a workflow, a monitor). With
 *  none: a Bash asked to run in the background, whose flag Claude Code writes as the text "true"
 *  as often as the boolean (claude-running-rows-2.1.296.json). A failed call never. */
function startedBackgroundWork(call: NativeChatToolCallBlock, result: NativeChatToolResultBlock | undefined): boolean {
  if (result?.isError === true) {
    return false
  }
  if (result !== undefined) {
    return !TASK_TOOLS.has(call.name) && readLaunch({ name: call.name, input: call.input, startedAt: null }, result.output) !== null
  }
  if (claudeToolCategory(call.name) !== 'Bash') {
    return false
  }
  const flag = inputsOf(call).run_in_background
  return flag === true || flag === 'true'
}

export type ClaudeLiveToolCall = {
  /** The call the row names, and its result when it has one (a Held call). */
  pair: NativeChatToolPair & { call: NativeChatToolCallBlock }
  /** `p2k` Running (no result yet) or `o2k` Held (the group's last call, finished). */
  running: boolean
  /** When the open turn's prompt was recorded, epoch ms, or null. */
  promptAt: number | null
}

function isPrompt(message: NativeChatMessage): boolean {
  return message.role === 'user' && message.blocks.some((block) => block.type === 'text')
}

/** A message the transcript draws something for after a tool group: text or an image. */
function drawsContent(message: NativeChatMessage): boolean {
  return message.blocks.some(
    (block) => (block.type === 'text' && block.text.trim().length > 0) || block.type === 'image-ref'
  )
}

/**
 * The call the live tool row names, as `su8.h7` picks it (zr8.java:917-990): the open turn's newest
 * tool group, the run of tool calls with nothing drawn after it; in it the newest call with no
 * result that did not start background work, else the group's last call when that did not start
 * background work. Null with no group. Calls and results pair as the chat's tool rows pair them
 * (`pairToolBlocks`).
 */
export function claudeLiveToolCall(messages: readonly NativeChatMessage[]): ClaudeLiveToolCall | null {
  let start = 0
  let promptAt: number | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isPrompt(messages[i]!)) {
      start = i + 1
      promptAt = messages[i]!.timestamp
      break
    }
  }
  const turn = messages.slice(start)
  // The group: the calls after the last message that draws something.
  let groupStart = 0
  for (let i = turn.length - 1; i >= 0; i--) {
    const message = turn[i]!
    if (message.blocks.some((block) => block.type === 'tool-call')) {
      // A message that both says something and calls tools: its calls are the group's start.
      if (drawsContent(message)) {
        groupStart = i
        break
      }
      continue
    }
    if (drawsContent(message)) {
      groupStart = i + 1
      break
    }
  }
  // Paired over the whole turn as the transcript's rows pair them (a call's result can come after
  // text in another message, and Orca's rows give a result no `callId`).
  const resultByCall = new Map<NativeChatToolCallBlock, NativeChatToolResultBlock>()
  for (const pair of pairToolBlocks(turn.flatMap((message) => message.blocks))) {
    if (pair.call && pair.result) {
      resultByCall.set(pair.call, pair.result)
    }
  }
  const calls: NativeChatToolCallBlock[] = []
  for (const message of turn.slice(groupStart)) {
    for (const block of message.blocks) {
      if (block.type === 'tool-call') {
        calls.push(block)
      }
    }
  }
  if (calls.length === 0) {
    return null
  }
  const resultOf = (call: NativeChatToolCallBlock): NativeChatToolResultBlock | undefined => resultByCall.get(call)
  const isRunning = (call: NativeChatToolCallBlock): boolean =>
    call.state ? call.state === 'running' : resultOf(call) === undefined
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i]!
    if (isRunning(call) && !startedBackgroundWork(call, undefined)) {
      return { pair: { call }, running: true, promptAt }
    }
  }
  const last = calls.at(-1)!
  const result = resultOf(last)
  if (isRunning(last) || startedBackgroundWork(last, result)) {
    return null
  }
  return { pair: result ? { call: last, result } : { call: last }, running: false, promptAt }
}
