import type { DesktopPrompt } from '../agent-hud-beacon'
import { normalizeNativeChatUserText } from '../../../../src/shared/native-chat-image-transcript-markers'

/**
 * When the transcript itself has the record of a message the phone sent, the
 * record wins over the phone's own echo of it.
 *
 * Why: a send made mid-turn never gets a user row, so its pending echo is
 * placed by the phone's guess of where it was — and that guess was three
 * turns under the reply that answered it (device, 2026-09-19). The
 * `queued_command` record the tail reads says exactly when it was taken.
 * So a pending text echo with a transcript twin steps aside for the twin;
 * an echo carrying photos stays, because the phone has bytes the record
 * has not.
 */
const key = (text: string) => normalizeNativeChatUserText(text)

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
