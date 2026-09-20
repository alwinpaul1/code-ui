import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import { withoutPasteWrappers } from './mobile-native-chat-paste-wrapper'

/**
 * Where the agent TOOK each of the phone's own queued sends: the last raw row
 * the phone held when the send's row left the agent's queue box.
 *
 * Why: a send made while the agent is busy is drawn where the phone guessed
 * it went — the tail at send time, or the hook's submit time against the rows
 * loaded then — and Claude Code draws it where it was taken, after the tool
 * calls that ran while it waited ("Ran 10 shell commands", then the message;
 * the phone said 8, device 2026-09-20). The queue box is the agent saying,
 * row by row, what is still waiting; the row's disappearance is the take.
 *
 * Keyed as the screen paints text (`absorbedQueueKey`), so a typed message
 * and its painted row meet. Bounded; the newest sends are the ones on screen.
 */
export type OwnQueueAbsorption = ReadonlyMap<string, string>

const ABSORPTION_CAP = 64

export function absorbedQueueKey(text: string): string {
  return normalizeNativeChatUserText(asPaintedPrompt(withoutPasteWrappers(text)))
}

/** Advance by one screen reading. `previousQueued` and `queued` are the
 *  box's rows before and after; `own` the phone's own send texts (pending
 *  and hook prompts); `tailId` the last raw row held now. */
export function observeOwnQueueAbsorption(
  previous: OwnQueueAbsorption,
  previousQueued: readonly string[],
  queued: readonly string[],
  own: readonly string[],
  tailId: string | null
): OwnQueueAbsorption {
  if (tailId === null || previousQueued.length === 0) {
    return previous
  }
  const live = new Set(queued.map(absorbedQueueKey))
  const ownKeys = new Set(own.map(absorbedQueueKey))
  let next: Map<string, string> | null = null
  for (const row of previousQueued) {
    const key = absorbedQueueKey(row)
    if (key.length === 0 || live.has(key) || !ownKeys.has(key) || previous.has(key)) {
      continue
    }
    next ??= new Map(previous)
    if (next.size >= ABSORPTION_CAP) {
      const oldest = next.keys().next()
      if (!oldest.done) {
        next.delete(oldest.value)
      }
    }
    next.set(key, tailId)
  }
  return next ?? previous
}

/** The pending items to draw, each of the phone's own queued sends placed
 *  where the agent took it once the queue box let it go. */
export function withAbsorbedPlacement<T extends { text: string; baselineTailMessageId: string | null }>(
  pending: readonly T[],
  absorbed: OwnQueueAbsorption
): T[] {
  if (absorbed.size === 0) {
    return [...pending]
  }
  return pending.map((item) => {
    const taken = absorbed.get(absorbedQueueKey(item.text))
    return taken === undefined || taken === item.baselineTailMessageId
      ? item
      : { ...item, baselineTailMessageId: taken, baselineResolved: true }
  })
}
