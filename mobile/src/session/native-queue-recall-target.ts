import { recallNativeQueue, type QueueEdit } from './native-queue-editor'
import { QueueRecallTakesWholeQueueError, type QueueEditorAgent, type QueueEditorIo } from './native-queue-input'

/** The recall a tap asks for. 'composer' (tap-to-edit) recalls one message;
 *  where the agent's recall would take the whole queue (stock Claude, several
 *  queued) it becomes the sheet's recall, which can put the rest back. Decided
 *  before any key: the refusal comes from the screen read alone. */
export async function recallNativeQueueFor(
  target: 'sheet' | 'composer',
  io: QueueEditorIo,
  agent: QueueEditorAgent,
  index?: number,
  tapped?: string
): Promise<{ recall: QueueEdit; target: 'sheet' | 'composer' }> {
  if (target === 'sheet') {
    return { recall: await recallNativeQueue(io, agent, index, tapped), target }
  }
  try {
    return { recall: await recallNativeQueue(io, agent, index, tapped, 'one'), target }
  } catch (cause) {
    if (!(cause instanceof QueueRecallTakesWholeQueueError)) {
      throw cause
    }
    return { recall: await recallNativeQueue(io, agent, index, tapped), target: 'sheet' }
  }
}
