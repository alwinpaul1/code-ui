import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import { isToolCallBlock, type NativeChatBlock, type NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'

/** The turn's call still in flight, for the run's shimmering "Running" row
 *  (structured lane only). Orca's `selectActiveToolCall` takes the newest call
 *  the lane marks running, or, while the turn works, the newest call with no
 *  state at all, and never looks at results: a stateless call kept sweeping
 *  "Running" over its own answer for as long as the turn thought on.
 *
 *  The same rule, save that a STATELESS call with its result is finished and
 *  passed over for an older one still going (two parallel calls, the newer one
 *  answered first: dropping the newest alone lost the Running row of the older
 *  one, review of 68455cc6c). A call the lane explicitly marks `running` keeps
 *  its row even with a result block: the structured projection emits a result
 *  for whatever output a row carries, and a command streaming partial output is
 *  still running. The turn's end still settles it. */
export function inFlightToolCall(
  tools: readonly NativeChatBlock[],
  { activeTurnIsWorking }: { activeTurnIsWorking?: boolean }
): NativeChatToolCallBlock | null {
  if (activeTurnIsWorking === false) {
    return null
  }
  const answered = new Set<NativeChatToolCallBlock>()
  for (const pair of pairToolBlocks(tools)) {
    if (pair.call && pair.result) {
      answered.add(pair.call)
    }
  }
  const calls = tools.filter(isToolCallBlock)
  for (let index = calls.length - 1; index >= 0; index--) {
    const call = calls[index]!
    if (call.state === 'running') {
      return call
    }
    if (call.state == null && activeTurnIsWorking === true && !answered.has(call)) {
      return call
    }
  }
  return null
}
