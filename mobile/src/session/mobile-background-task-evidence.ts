import {
  isTextBlock,
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatMessage
} from '../../../src/shared/native-chat-types'
import {
  INTERRUPTED,
  readLaunch,
  readNotifications,
  readString,
  stoppedTaskId,
  takeAnsweredCall,
  type PendingCall
} from './mobile-background-task-transcript'

// ─── What one loaded window of the lead's transcript proves ──────────────────
//
// The roster cannot tell the lead's agents from the reviewers they start (see
// `mobile-background-task-roster.ts`); the lead's own transcript can, for as
// long as the phone holds the part of it that shows the launch. This reads
// that part. `mobile-background-task-memory.ts` keeps what it proved once the
// window has slid past.

/** An Agent call of the lead's still waiting for its result. A foreground
 *  agent's result, and so its `agentId`, is written only when its run ends;
 *  until then the call is the only sign the lead started it. */
export type PendingAgentCall = {
  /** The call's own place in the transcript, so it vouches once. */
  key: string
  at: number | null
  subagentType: string | null
}

/** A background shell the window shows launched, by the label its completion
 *  row will quote (`Launch.label`: the Bash `description`, else the command,
 *  whitespace folded). */
export type LabelledShellLaunch = { id: string; label: string }

export type WindowTaskEvidence = {
  /** Agents the lead launched (`agentId:` in an Agent result) or messaged
   *  (SendMessage `to`, which resumes one that had finished). */
  ownAgentIds: string[]
  /** Labelled shell launches, oldest first, one per id: what a completion row
   *  read off the screen can name (`mobile-screen-completion-memory.ts`). A
   *  monitor quotes no label and is not here. */
  shellLaunches: LabelledShellLaunch[]
  /** Ids the window shows ending: a notification, or a TaskStop whose answer
   *  says it went through, which no notification follows. A stop turned down
   *  or still waiting on its answer ends nothing. */
  retiredTaskIds: string[]
  pendingAgentCalls: PendingAgentCall[]
  /** The earliest time the window reaches back to; null when it holds no
   *  timed message. The lead launched nothing after this that it does not
   *  show. */
  oldestAt: number | null
}

/** Agent ids, and names given to SendMessage, are this alphabet. */
const TARGET = /^[A-Za-z0-9_@.-]+$/
/** A background launch's result, as Claude Code writes it: the sentence
 *  opens the result, so a command whose output merely quotes an id does not
 *  match. Read from any result, not only the one first-in-first-out pairing
 *  hands the Agent call: results land in the order launches were
 *  acknowledged, so a turn's Agent and Bash results can come back swapped. */
const ASYNC_AGENT_LAUNCHED = /^\s*Async agent launched successfully\.[\s\S]*?\bagentId:\s*([A-Za-z0-9_-]+)/

type Pending = PendingCall & { key: string }

/** Launches and endings in one loaded window, paired the way
 *  `deriveBackgroundTasks` pairs them: first in, first out, with an
 *  interrupted turn's unanswered calls dropped. */
export function readTaskEvidence(messages: readonly NativeChatMessage[]): WindowTaskEvidence {
  const pending: Pending[] = []
  const ownAgentIds: string[] = []
  const shellLaunches: LabelledShellLaunch[] = []
  const retiredTaskIds: string[] = []
  let oldestAt: number | null = null
  for (const message of messages) {
    if (message.timestamp !== null && (oldestAt === null || message.timestamp < oldestAt)) {
      oldestAt = message.timestamp
    }
    let text = ''
    message.blocks.forEach((block, index) => {
      if (isToolCallBlock(block)) {
        pending.push({ name: block.name, input: block.input, startedAt: message.timestamp, key: `${message.id}#${index}` })
        const target = block.name === 'SendMessage' ? readString(block.input, 'to') : null
        if (target && TARGET.test(target)) {
          ownAgentIds.push(target)
        }
      } else if (isToolResultBlock(block)) {
        const call = takeAnsweredCall(pending, block.output)
        // A stop ends its task once its answer says it went through, as in
        // `deriveBackgroundTasks`: the memory keeps a retired id for good.
        const stopped = call ? stoppedTaskId(call, block) : null
        if (stopped) {
          retiredTaskIds.push(stopped)
        }
        const launch = call ? readLaunch(call, block.output) : null
        const launched = launch?.kind === 'agent' ? launch.id : ASYNC_AGENT_LAUNCHED.exec(block.output)?.[1]
        if (launched) {
          ownAgentIds.push(launched)
        }
        if (launch?.kind === 'shell' && launch.label !== null && !shellLaunches.some((known) => known.id === launch.id)) {
          shellLaunches.push({ id: launch.id, label: launch.label })
        }
      } else if (isTextBlock(block)) {
        text += block.text
      }
    })
    if (INTERRUPTED.test(text)) {
      pending.length = 0
    }
    for (const notification of readNotifications(text, 0)) {
      retiredTaskIds.push(notification.id)
    }
  }
  // A background launch's result lands within seconds and names its id, so
  // only a foreground call waits long enough to need to vouch for its row —
  // and a background call left pending in that gap could vouch for a reviewer
  // whose row came up first.
  const pendingAgentCalls = pending
    .filter((call) => call.name === 'Agent' && Reflect.get(Object(call.input), 'run_in_background') !== true)
    .map((call) => ({ key: call.key, at: call.startedAt, subagentType: readString(call.input, 'subagent_type') }))
  return { ownAgentIds, shellLaunches, retiredTaskIds, pendingAgentCalls, oldestAt }
}
