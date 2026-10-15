import type { NativeChatMessage, NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import { workingMarkKindForTool, type WorkingMarkKind } from './claude-working-mark'

/** A user message the person typed (text), not a tool result fed back to the agent. */
function isPrompt(message: NativeChatMessage): boolean {
  return message.role === 'user' && message.blocks.some((block) => block.type === 'text')
}

/**
 * The working mark's kind for the live turn, as the Claude app picks it (`zr8` case 18, 1.261013.20):
 * the newest tool call of this turn still running; with none running and no thinking under way,
 * the turn's last tool call; otherwise Think. A call is running until a result answers it, by
 * `callId` when both carry one, else by position.
 */
export function workingMarkKindFromTranscript(messages: readonly NativeChatMessage[], thinking: boolean): WorkingMarkKind {
  let start = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isPrompt(messages[i]!)) {
      start = i + 1
      break
    }
  }
  const calls: NativeChatToolCallBlock[] = []
  const answeredIds = new Set<string>()
  let positionalResults = 0
  for (const message of messages.slice(start)) {
    for (const block of message.blocks) {
      if (block.type === 'tool-call') {
        calls.push(block)
      } else if (block.type === 'tool-result') {
        if (block.callId) {
          answeredIds.add(block.callId)
        } else {
          positionalResults++
        }
      }
    }
  }
  const unpaired = calls.filter((call) => !call.callId)
  const running = calls.filter((call) => {
    if (call.state) {
      return call.state === 'running'
    }
    if (call.callId) {
      return !answeredIds.has(call.callId)
    }
    return unpaired.indexOf(call) >= positionalResults
  })
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
