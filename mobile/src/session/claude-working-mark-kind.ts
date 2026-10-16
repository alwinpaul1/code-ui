import type { NativeChatMessage, NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import { workingMarkKindForTool, type WorkingMarkKind } from './claude-working-mark'

/** A user message the person typed (text), not a tool result fed back to the agent. */
function isPrompt(message: NativeChatMessage): boolean {
  return message.role === 'user' && message.blocks.some((block) => block.type === 'text')
}

/**
 * The working mark's kind for the live turn, as the Claude app picks it (`zr8` case 18, 1.261013.20):
 * the newest tool call of this turn still running; with none running and no thinking under way,
 * the turn's last tool call; otherwise Think. A call is running until a result answers it, paired
 * as the chat's tool rows pair them (`pairToolBlocks`): by `callId` when the result carries one,
 * else in order. Orca's rows give the call a `callId` and its result none, so pairing by the
 * call's id alone left every Orca call running and the mark on a finished tool's form.
 */
export function workingMarkKindFromTranscript(messages: readonly NativeChatMessage[], thinking: boolean): WorkingMarkKind {
  let start = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isPrompt(messages[i]!)) {
      start = i + 1
      break
    }
  }
  const answered = new Set<NativeChatToolCallBlock>()
  const calls: NativeChatToolCallBlock[] = []
  for (const pair of pairToolBlocks(messages.slice(start).flatMap((message) => message.blocks))) {
    if (pair.call) {
      calls.push(pair.call)
      if (pair.result) {
        answered.add(pair.call)
      }
    }
  }
  const running = calls.filter((call) => (call.state ? call.state === 'running' : !answered.has(call)))
  const live = running.at(-1)
  if (live) {
    return workingMarkKindForTool(live.name)
  }
  const last = calls.at(-1)
  if (last && !thinking) {
    return workingMarkKindForTool(last.name)
  }
  return 'think'
}
