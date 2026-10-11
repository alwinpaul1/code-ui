import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import { selectActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import type { NativeChatBlock, NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'

/** The turn's call still in flight, for the run's shimmering "Running" row
 *  (structured lane only). Orca's `selectActiveToolCall` picks the newest call
 *  the lane marks running, or, while the turn works, the newest call with no
 *  state at all, and never looks at results: a call whose state the lane never
 *  moved on kept sweeping "Running" over its own answer until the turn ended.
 *  A call with its result is finished, whatever its state says (the same rule
 *  as the agent row's, mobile-native-chat-agent-run.ts, and the detail sheet's
 *  `toolDetailStatus`). */
export function inFlightToolCall(
  tools: readonly NativeChatBlock[],
  options: { activeTurnIsWorking?: boolean }
): NativeChatToolCallBlock | null {
  const call = selectActiveToolCall(tools, options)
  if (!call) {
    return null
  }
  return pairToolBlocks(tools).some((pair) => pair.call === call && pair.result !== undefined) ? null : call
}
