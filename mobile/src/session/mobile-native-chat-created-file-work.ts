// Background work a cut create's count cannot see past. A shell, a monitor,
// an agent or a teammate launched before the create, or a command the user
// ran with `!` that went to the background, keeps running after its call
// returns, and what it writes has no call in this transcript. So while
// one launched before the create has not reported by it, the file on the
// desktop is not provably the Write's (review of 2026-09-26: a background
// agent went on writing to a 93-line create and the chip drew +125).
//
// The launch and finish records are the background-task reader's own
// (mobile-background-task-transcript.ts), paired the way
// `deriveBackgroundTasks` pairs them, which in a batch, the calls waiting for
// answers together, is a guess. The pairing hands a failure to the first call
// waiting, an answer shaped like an Agent result to the first Agent call, and
// anything else to the first that is no Agent call, so a quick call can take
// another's answer. So when a batch closes (every call answered, an
// interrupt, or the end of the transcript):
// - a call that may launch (a shell, a monitor, an agent) and was handed an
//   answer that launched nothing (for an agent, a failure or a report), or
//   that is still waiting, runs under any launch of it an answer in the batch
//   names (review of 5b257b16: a background agent beside a Read that failed
//   first lost its launch to the Read). This holds for a call answered last
//   and alone too: the answer it lost may have gone to a call answered
//   before it. An agent's launch there is its launch sentence or the JSON
//   launch, `{"resultType":"task",…}`, whatever its call asked for, and no
//   other JSON (review of e53a4074: a `cat package.json` beside a background
//   agent the user turned down read as its launch and ran for good);
// - a stop ends its task unless a failure landed in the batch and no answer
//   there is TaskStop's own word that the task is no longer running: its
//   JSON, or `Task <id> is not running (status: completed|failed|killed)`
//   (Claude Code 2.1.283; review of 311f41ad: a stop turned down beside a
//   Read took the Read's answer). A failure is a `<tool_use_error>`, a
//   turn-down, a cancel, a denial, or an answer Orca marks as an error; a
//   batch the user interrupted with a call still waiting counts as one. The
//   not-running line is no failure when a stop already called in the batch
//   names its task: whichever call it answered, TaskStop's own answer is
//   then that line or its JSON, so the stop holds (review of 39937aee: a
//   stop of a task already done, beside an `npm test`, was taken back).
//   TaskStop's word is taken only from a batch that closed with every call
//   answered and held no call that could print it (review of 5b257b16: a
//   `grep` printed the not-running line beside a stop turned down, and a
//   call never answered drew a later stop that worked into the batch). Of
//   several stops of one task there, only as many stand as TaskStop's words
//   for it, the latest first (review of d3bb3304: a stop turned down and a
//   second that worked shared the one word, and the first ended the task
//   before a create between them).
// The limits, each of which refuses:
// - a task that ended in a way the transcript does not record (a mid-turn
//   completion Orca does not surface) is still running here;
// - a teammate never reports, so it runs for the rest of the transcript;
// - an agent a message woke runs until its next report;
// - an Agent call with no answer yet, or one whose answer names no id and is
//   no foreground report, runs for good;
// - a launch in a batch also runs from every call there that may launch and
//   was handed none, so a create between the two refuses even when the
//   launch was called after it.
// A task launched before the loaded window is seen only by its trace there:
// a finish or stop that names it, its launch answer when the window cut off
// the call, or a teammate's message, each of which runs from the window's
// start (review of 8b2ef369: a background agent launched before the window
// went on writing a 93-line create and the chip drew +125). Without a trace
// it is not seen at all, which is why the count is read only from the whole
// session (MobileNativeChatOverlay.tsx). A foreground
// report long enough for the wire to cut has lost its usage block, and its
// id line past about 3,900 characters, so a cut answer is read as a finished
// report when it goes to an Agent call that asked for no background, opens
// with no launch sentence and no JSON, and no other kind of call was waiting
// for it (review of 3598d39b: such a report ran for good and held every later
// count off). A command's long output can quote a report, id line and all,
// and is then paired to the Agent call beside it (review of de0eef80); and
// the diet drops a long prompt's later keys, `run_in_background` among them,
// so a launch in the JSON shape could pass for a report.

import {
  isTextBlock,
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatMessage,
  type NativeChatToolCallBlock,
  type NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import { FINISHED_RUN_USAGE } from './mobile-background-task-agent-titles'
import {
  AGENT_LAUNCH_OPENING,
  ANY_TOOL_FAILURE,
  INTERRUPTED,
  readLaunch,
  readNotifications,
  readString,
  takeAnsweredCall,
  type Launch,
  type PendingCall
} from './mobile-background-task-transcript'
import { MOBILE_CUT } from './mobile-native-chat-edit-wire-cut'
import { toolCallKind } from './mobile-native-chat-tool-sentence'

type Ending = { id: string; at: number }
type Pending = PendingCall & { at: number }
/** The calls waiting for answers together: the answers they took, the
 *  endings their TaskStops recorded, the calls that may have lost their
 *  launch to another call, whether any answer was a failure, and whether any
 *  call there could answer with text of its own, TaskStop's words included. */
type Batch = {
  answers: string[]
  stops: Ending[]
  unsure: Pending[]
  failed: boolean
  mayQuote: boolean
}
/** A task running from `from` until its first ending after that, if any. A
 *  null id is a task no ending names. */
type Span = { from: number; id: string | null }

function askedForBackground(call: Pending): boolean {
  return Reflect.get(Object(call.input), 'run_in_background') === true
}

const JSON_OPENING = /^\s*\{/

/** An Agent call's answer that leaves an agent running: anything but a
 *  failure, or a foreground run's report (its usage block, or the cut that
 *  took it). `onlyAgentsWaited` says no other kind of call could own the
 *  answer. */
function leftAgentRunning(call: Pending, output: string, onlyAgentsWaited: boolean): boolean {
  if (ANY_TOOL_FAILURE.test(output) || FINISHED_RUN_USAGE.test(output)) {
    return false
  }
  const cutReport =
    onlyAgentsWaited &&
    output.endsWith(MOBILE_CUT) &&
    !AGENT_LAUNCH_OPENING.test(output) &&
    !JSON_OPENING.test(output) &&
    !askedForBackground(call)
  return !cutReport
}

const CANCELLED = /^\s*The user doesn't want to take this action right now/
const DENIED = /^\s*Permission (?:for this |to use )[\s\S]*?(?:was|has been) denied/
const ENDED = ['completed', 'failed', 'killed']

/** An answer saying its call did not do what it was asked. */
function isFailure(block: NativeChatToolResultBlock): boolean {
  return (
    block.isError === true ||
    ANY_TOOL_FAILURE.test(block.output) ||
    CANCELLED.test(block.output) ||
    DENIED.test(block.output)
  )
}

/** Whether an answer is TaskStop's own word that `id` is no longer running:
 *  its data as JSON, stopped or outlived by a loop, or its input check on a
 *  task that had ended (Claude Code 2.1.283). */
function saysStopped(output: string, id: string): boolean {
  const answer = output.trimStart()
  return [
    `{"message":"Successfully stopped task: ${id} (`,
    `{"message":"Task ${id} `,
    ...ENDED.map((status) => `<tool_use_error>Task ${id} is not running (status: ${status})`)
  ].some((opening) => answer.startsWith(opening))
}

/** Tools whose answers cannot open with TaskStop's words: its own, a Read's
 *  numbered lines, a Glob or LS listing, and the edit tools' sentences. */
const OWN_WORDS = new Set([
  'TaskStop',
  'Read',
  'Glob',
  'LS',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit'
])

function openBatch(): Batch {
  return { answers: [], stops: [], unsure: [], failed: false, mayQuote: false }
}

/** Claude Code's PowerShell tool backgrounds a command as Bash does, and
 *  answers in Bash's sentences: one function builds both in 2.1.283. The
 *  background-task reader reads Bash's only, so PowerShell's are read as
 *  Bash's here. */
function launchOf(call: Pending, output: string): Launch | null {
  const sentence = readLaunch(call.name === 'PowerShell' ? { ...call, name: 'Bash' } : call, output)
  if (sentence || toolCallKind(call.name) === 'agent' || !JSON_LAUNCH.test(output)) {
    return sentence
  }
  // Claude Code 2.1.283 behind the tengu_violin_rosin flag answers a
  // background shell as JSON, its sentence in statusMessage (review of
  // c6d8394a: the shell went unseen).
  const id = JSON_TASK_ID.exec(output)?.[1]
  return id ? { id, kind: 'shell', title: '', startedAt: call.startedAt, label: null } : null
}

const JSON_TASK_ID = /"taskId"\s*:\s*"([^"]+)"/

/** Calls whose answer can launch work that keeps running. */
function mayLaunch(call: Pending): boolean {
  return (
    toolCallKind(call.name) === 'agent' ||
    call.name === 'Bash' ||
    call.name === 'PowerShell' ||
    call.name === 'Monitor'
  )
}

/** The launch a server flag serves in Claude Code 2.1.283, the whole answer
 *  JSON: `{"resultType":"task","taskId":…,"status":"working",…}`, keys in the
 *  order its source builds them. A file a command printed, or another tool's
 *  JSON, is not one. */
const JSON_LAUNCH = /^\s*\{\s*"resultType"\s*:\s*"task"/

/** The id an answer launches `call` under: null for a launch that names no
 *  id, undefined when the answer is no launch of it. */
function launchIn(call: Pending, answer: string): string | null | undefined {
  if (toolCallKind(call.name) !== 'agent') {
    return launchOf(call, answer)?.id
  }
  const launches = AGENT_LAUNCH_OPENING.test(answer) || JSON_LAUNCH.test(answer)
  return launches ? (launchOf(call, answer)?.id ?? null) : undefined
}

/** Closes a batch. Each call that may have lost its launch to another, and
 *  each call still waiting, runs under every launch of it an answer there
 *  names. Then each stop is taken back if a failure landed in the batch,
 *  unless TaskStop said its task was no longer running, once for it and for
 *  each later stop of that task, in a batch every call answered and none
 *  could have said it for TaskStop. */
function settle(batch: Batch, waiting: Pending[], endings: Ending[], spans: Span[]): void {
  for (const call of [...batch.unsure, ...waiting.filter(mayLaunch)]) {
    for (const answer of batch.answers) {
      const id = launchIn(call, answer)
      if (id !== undefined) {
        spans.push({ from: call.at, id })
      }
    }
  }
  if (!batch.failed) {
    return
  }
  const vouched = waiting.length === 0 && !batch.mayQuote
  // Of several stops of one task, only as many stand as TaskStop's word
  // vouches for, and the latest of them: which one it answered is a guess.
  for (const [index, stop] of batch.stops.entries()) {
    const said = batch.answers.filter((answer) => saysStopped(answer, stop.id)).length
    const later = batch.stops.slice(index + 1).filter((other) => other.id === stop.id).length
    if (!vouched || later >= said) {
      endings.splice(endings.indexOf(stop), 1)
    }
  }
}

/** Whether a call left behind with no answer may still be running. */
function mayRunOn(call: Pending): boolean {
  return toolCallKind(call.name) === 'agent' || call.name === 'Monitor' || askedForBackground(call)
}

/** The id an answer launches work under when its call is not in the window:
 *  a shell's or a monitor's sentence, or an agent's launch (null when it
 *  names none); undefined for any other answer. */
function orphanLaunchId(answer: string): string | null | undefined {
  for (const name of ['Bash', 'Monitor']) {
    const launch = readLaunch({ name, input: null, startedAt: null }, answer)
    if (launch) {
      return launch.id
    }
  }
  if (AGENT_LAUNCH_OPENING.test(answer) || JSON_LAUNCH.test(answer)) {
    return readLaunch({ name: 'Agent', input: null, startedAt: null }, answer)?.id ?? null
  }
  return undefined
}

/** A message from another agent: one working beside this session, which
 *  the transcript does not say has stopped. */
const TEAMMATE_MESSAGE = /<teammate-message\b/

const USER_COMMAND_OUTPUT = '<bash-stdout>'

/** A command the user ran with `!` that went to the background. Its output
 *  turn holds the Bash call's own sentence (Claude Code 2.1.247 to 2.1.263). */
function userCommandLaunch(text: string): Launch | null {
  if (!text.startsWith(USER_COMMAND_OUTPUT)) {
    return null
  }
  const output = text.slice(USER_COMMAND_OUTPUT.length)
  return readLaunch({ name: 'Bash', input: null, startedAt: null }, output)
}

/** For each call in `messages`, whether background work launched before it
 *  was still running when it ran. Blocks are placed by identity, so ask with
 *  a call block from these messages; any other call is asked about nothing. */
export function backgroundWorkRunningAt(
  messages: readonly NativeChatMessage[]
): (call: NativeChatToolCallBlock) => boolean {
  const places = new Map<NativeChatToolCallBlock, number>()
  const pending: Pending[] = []
  const spans: Span[] = []
  const endings: Ending[] = []
  let batch = openBatch()
  let at = 0
  for (const message of messages) {
    let text = ''
    for (const block of message.blocks) {
      at += 1
      if (isToolCallBlock(block)) {
        places.set(block, at)
        const stopped = block.name === 'TaskStop' ? readString(block.input, 'task_id') : null
        if (stopped) {
          const stop = { id: stopped, at }
          endings.push(stop)
          batch.stops.push(stop)
        }
        pending.push({ name: block.name, input: block.input, startedAt: message.timestamp, at })
        batch.mayQuote ||= !OWN_WORDS.has(block.name)
        // A message wakes an agent that had finished, or reaches a teammate.
        if (toolCallKind(block.name) === 'message') {
          spans.push({
            from: at,
            id: readString(block.input, 'to') ?? readString(block.input, 'recipient')
          })
        }
      } else if (isToolResultBlock(block)) {
        // Named as the pairing names it: `takeAnsweredCall` holds only an Agent call apart.
        const onlyAgentsWaited = pending.every((waiting) => waiting.name === 'Agent')
        // TaskStop answers a task already done with a `<tool_use_error>`, and
        // that says its stop holds.
        const stopHolds = batch.stops.some((stop) => saysStopped(block.output, stop.id))
        batch.failed ||= isFailure(block) && !stopHolds
        batch.answers.push(block.output)
        const call = takeAnsweredCall(pending, block.output)
        if (call) {
          const launch = launchOf(call, block.output)
          // A background call answered in words the phone does not know may
          // still be running, and refuses (review of c6d8394a).
          const running =
            toolCallKind(call.name) === 'agent'
              ? leftAgentRunning(call, block.output, onlyAgentsWaited)
              : launch !== null || (askedForBackground(call) && !isFailure(block))
          if (running) {
            spans.push({ from: call.at, id: launch?.id ?? null })
          } else if (mayLaunch(call)) {
            batch.unsure.push(call)
          }
        } else {
          const orphan = orphanLaunchId(block.output)
          if (orphan !== undefined) {
            spans.push({ from: 0, id: orphan })
          }
        }
        if (pending.length === 0) {
          settle(batch, pending, endings, spans)
          batch = openBatch()
        }
      } else if (isTextBlock(block)) {
        text += block.text
        const launch = userCommandLaunch(block.text)
        if (launch) {
          spans.push({ from: at, id: launch.id })
        }
        if (TEAMMATE_MESSAGE.test(block.text)) {
          spans.push({ from: 0, id: null })
        }
      }
    }
    if (INTERRUPTED.test(text)) {
      batch.failed ||= pending.length > 0
      settle(batch, pending, endings, spans)
      batch = openBatch()
      pending.length = 0
    }
    for (const notification of readNotifications(text, at)) {
      endings.push({ id: notification.id, at })
    }
  }
  settle(batch, pending, endings, spans)
  for (const call of pending) {
    if (mayRunOn(call)) {
      spans.push({ from: call.at, id: null })
    }
  }
  // A task that finished or was stopped with no launch in the window was
  // launched before it, and ran from its start.
  for (const ending of endings) {
    if (!spans.some((span) => span.id === ending.id)) {
      spans.push({ from: 0, id: ending.id })
    }
  }
  const running = spans.map(({ from, id }) => ({
    from,
    to: endings.find((ending) => ending.id === id && ending.at > from)?.at ?? null
  }))
  return (call) => {
    const place = places.get(call)
    return (
      place !== undefined &&
      running.some(({ from, to }) => from < place && (to === null || to > place))
    )
  }
}
