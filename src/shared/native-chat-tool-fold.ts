import {
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatBlock,
  type NativeChatMessage
} from './native-chat-types'
import { isKnownHarnessInjectedUserTurnText } from './harness-injected-user-turns'
import { isNoiseMessage } from './native-chat-noise'
// CODE UI HAND-APPLIED UPSTREAM HUNK (Orca #26968, 8452fc3315): pairing moved to
// native-chat-tool-pairs.ts (same answers, an id index for out-of-order results). The fold's own
// #26968 change (unpaired results as separate rows) is not taken; see src/shared/LOCAL-FILES.md.
export { pairToolBlocks, type NativeChatToolPair } from './native-chat-tool-pairs'

function isToolOnlyMessage(message: NativeChatMessage): boolean {
  return (
    message.blocks.length > 0 &&
    message.blocks.every((block) => isToolCallBlock(block) || isToolResultBlock(block))
  )
}

function isHarnessSidecarToolMessage(message: NativeChatMessage): boolean {
  if (
    message.role !== 'user' ||
    isInterruptionBoundary(message) ||
    !message.blocks.some(isToolResultBlock)
  ) {
    return false
  }
  const textBlocks = message.blocks.filter((block) => block.type === 'text')
  return (
    textBlocks.length > 0 &&
    message.blocks.every(
      (block) =>
        isToolResultBlock(block) ||
        (block.type === 'text' && isKnownHarnessInjectedUserTurnText(block.text))
    )
  )
}

function isInterruptionBoundary(message: NativeChatMessage): boolean {
  return message.blocks.some(
    (block) =>
      block.type === 'text' && block.text.trim().toLowerCase().startsWith('[request interrupted')
  )
}

// CODE UI HAND-APPLIED UPSTREAM HUNK (Orca #19468, 44eb95fc6) — see below and
// in `pairToolBlocks`. The file cannot be re-vendored whole at that commit: the
// same range carries #18773's subagent-roster fold, which is not taken (the
// block type is vendored since #26125; the fold's reordering is not). See
// src/shared/LOCAL-FILES.md.
/** Drop tool results the renderer cannot pair within their folded message. */
function dropUnattributableToolResults(message: NativeChatMessage): NativeChatMessage | null {
  let blocks: NativeChatBlock[] | undefined
  let unansweredCalls = 0
  for (let index = 0; index < message.blocks.length; index++) {
    const block = message.blocks[index]
    if (isToolCallBlock(block)) {
      unansweredCalls += 1
    } else if (isToolResultBlock(block)) {
      if (unansweredCalls === 0) {
        blocks ??= message.blocks.slice(0, index)
        continue
      }
      unansweredCalls -= 1
    }
    blocks?.push(block)
  }
  if (!blocks) {
    return message
  }
  return blocks.length > 0 ? { ...message, blocks } : null
}

/** Fold consecutive tool-only messages into their preceding assistant turn. */
export function foldToolMessages(messages: readonly NativeChatMessage[]): NativeChatMessage[] {
  const output: NativeChatMessage[] = []
  let mutableAssistantIndex = -1
  let clonedAssistantIndex = -1
  for (const message of messages) {
    if (isHarnessSidecarToolMessage(message) && mutableAssistantIndex >= 0) {
      const index = mutableAssistantIndex
      const assistant = output[index]
      if (assistant?.role === 'assistant') {
        if (clonedAssistantIndex !== index) {
          output[index] = { ...assistant, blocks: [...assistant.blocks] }
          clonedAssistantIndex = index
        }
        output[index].blocks.push(...message.blocks.filter(isToolResultBlock))
        output.push({
          ...message,
          blocks: message.blocks.filter((block) => !isToolResultBlock(block))
        })
        continue
      }
    }
    if (isToolOnlyMessage(message) && mutableAssistantIndex >= 0) {
      const index = mutableAssistantIndex
      const assistant = output[index]
      if (assistant?.role !== 'assistant') {
        output.push(message)
        mutableAssistantIndex = -1
        continue
      }
      if (clonedAssistantIndex !== index) {
        output[index] = { ...assistant, blocks: [...assistant.blocks] }
        clonedAssistantIndex = index
      }
      output[index]!.blocks.push(...message.blocks)
      continue
    }
    output.push(message)
    if (message.role === 'assistant') {
      mutableAssistantIndex = output.length - 1
      clonedAssistantIndex = -1
    } else if (!isNoiseMessage(message) || isInterruptionBoundary(message)) {
      mutableAssistantIndex = -1
      clonedAssistantIndex = -1
    }
  }
  const attributedOutput: NativeChatMessage[] = []
  for (const message of output) {
    const attributed = dropUnattributableToolResults(message)
    if (attributed) {
      attributedOutput.push(attributed)
    }
  }
  return attributedOutput
}

export function splitNativeChatBlocks(blocks: readonly NativeChatBlock[]): {
  prose: NativeChatBlock[]
  tools: NativeChatBlock[]
} {
  const prose: NativeChatBlock[] = []
  const tools: NativeChatBlock[] = []
  for (const block of blocks) {
    if (isToolCallBlock(block) || isToolResultBlock(block)) {
      tools.push(block)
    } else {
      prose.push(block)
    }
  }
  return { prose, tools }
}
