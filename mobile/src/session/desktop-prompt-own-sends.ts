import type { DesktopPrompt } from './agent-hud-beacon'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'

/**
 * When the host itself has a timed record of a message the phone sent, the
 * record wins over the phone's own echo of it.
 *
 * Why: a send made mid-turn never gets a user row, so its pending echo is
 * placed by the phone's guess of where it was — and that guess was three
 * turns under the reply that answered it (device, 2026-09-19). The tab
 * status's prompt (Orca's UserPromptSubmit hook) says when it was taken.
 * So a pending text echo with a timed twin steps aside for the twin; an
 * echo carrying photos stays, because the phone has bytes the record has
 * not.
 */
// Painted on both sides: `pending` can hold a restored screen reading, which
// has no backticks, beside the hook's typed copy (review, 2026-09-19).
const key = (text: string) => normalizeNativeChatUserText(asPaintedPrompt(text))

export function isTranscriptWitnessed(prompt: DesktopPrompt): boolean {
  return prompt.at !== undefined
}

/** The pending sends to draw: those with no transcript twin, plus any with images. */
export function pendingWithoutTranscriptTwins<T extends { text: string; images?: string[] }>(
  pending: readonly T[],
  prompts: readonly DesktopPrompt[]
): T[] {
  const witnessed = new Set(prompts.filter(isTranscriptWitnessed).map((p) => key(p.text)))
  if (witnessed.size === 0) {
    return [...pending]
  }
  return pending.filter((item) => Boolean(item.images?.length) || !witnessed.has(key(item.text)))
}

/** The pending texts that still hide a desktop prompt of the same text: the
 *  ones that are drawn. A pending send that stepped aside must not also
 *  suppress the twin that replaced it. */
export function pendingTextsStillDrawn<T extends { text: string; images?: string[] }>(
  pending: readonly T[],
  prompts: readonly DesktopPrompt[]
): string[] {
  return pendingWithoutTranscriptTwins(pending, prompts).map((item) => item.text)
}

/** The texts a hook prompt must not be drawn beside: the phone's own pending
 *  sends still drawn, and every row the agent's QUEUE BOX shows right now.
 *
 *  Why the queue rows: a send made while the agent is busy sits in Claude's
 *  queue box, and the phone hides its own bubble for as long as the row is
 *  there (`pendingOutsideVisibleQueue`). The hook fires on submit, so the
 *  same message also arrives as a desktop prompt at once; the own bubble then
 *  steps aside for that timed twin, and the twin was drawn as a bubble ABOVE
 *  the queue row that still showed the message — the same text twice on one
 *  screen until the agent took it (device, 2026-09-19). A message the queue
 *  box shows is not landed and not absorbed; it is queued, and the box is its
 *  one place until it leaves. */
export function textsAlreadyShown<T extends { text: string; images?: string[] }>(
  pending: readonly T[],
  prompts: readonly DesktopPrompt[],
  queued: readonly string[]
): string[] {
  return [...pendingTextsStillDrawn(pending, prompts), ...queued]
}
