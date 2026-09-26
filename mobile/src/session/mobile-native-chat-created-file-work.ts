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
// `deriveBackgroundTasks` pairs them, except that a TaskStop answered with a
// failure (the user turned it down) ends nothing. The limits, each of which
// refuses:
// - a task that ended in a way the transcript does not record (a mid-turn
//   completion Orca does not surface) is still running here;
// - a teammate never reports, so it runs for the rest of the transcript;
// - an agent a message woke runs until its next report;
// - an Agent call with no answer yet, or one whose answer names no id and is
//   no foreground report, runs for good.
// A task launched before the loaded window is not seen at all. A foreground
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
  type NativeChatToolCallBlock
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
/** `stops` is the ending a TaskStop call recorded, taken back if its answer
 *  is a failure. */
type Pending = PendingCall & { at: number; stops: Ending | null }
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

/** Whether a call left behind with no answer may still be running. */
function mayRunOn(call: Pending): boolean {
  return toolCallKind(call.name) === 'agent' || call.name === 'Monitor' || askedForBackground(call)
}

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
  let at = 0
  for (const message of messages) {
    let text = ''
    for (const block of message.blocks) {
      at += 1
      if (isToolCallBlock(block)) {
        places.set(block, at)
        const stopped = block.name === 'TaskStop' ? readString(block.input, 'task_id') : null
        const stops = stopped ? { id: stopped, at } : null
        if (stops) {
          endings.push(stops)
        }
        pending.push({
          name: block.name,
          input: block.input,
          startedAt: message.timestamp,
          at,
          stops
        })
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
        const call = takeAnsweredCall(pending, block.output)
        if (!call) {
          continue
        }
        if (call.stops && ANY_TOOL_FAILURE.test(block.output)) {
          endings.splice(endings.indexOf(call.stops), 1)
        }
        const launch = readLaunch(call, block.output)
        if (toolCallKind(call.name) === 'agent') {
          if (leftAgentRunning(call, block.output, onlyAgentsWaited)) {
            spans.push({ from: call.at, id: launch?.id ?? null })
          }
        } else if (launch) {
          spans.push({ from: call.at, id: launch.id })
        }
      } else if (isTextBlock(block)) {
        text += block.text
        const launch = userCommandLaunch(block.text)
        if (launch) {
          spans.push({ from: at, id: launch.id })
        }
      }
    }
    if (INTERRUPTED.test(text)) {
      pending.length = 0
    }
    for (const notification of readNotifications(text, at)) {
      endings.push({ id: notification.id, at })
    }
  }
  for (const call of pending) {
    if (mayRunOn(call)) {
      spans.push({ from: call.at, id: null })
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
