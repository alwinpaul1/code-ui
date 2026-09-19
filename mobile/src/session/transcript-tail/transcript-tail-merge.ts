import type { DesktopPrompt } from '../agent-hud-beacon'
import { queueRowIsPendingSend } from '../mobile-terminal-queued-messages'
import type { TranscriptTailPrompt } from './transcript-tail-records'

/**
 * The transcript's prompts and the beacon's, as one list for the chat.
 *
 * Both can carry the same message: a phone-launched session beacons a
 * desktop prompt from its UserPromptSubmit hook AND writes the same prompt to
 * its transcript. The transcript's copy wins — it names the exact row the
 * message was submitted after — and the beacon's copy is dropped when its
 * text matches one. A beacon prompt with no transcript twin (the tail not up
 * yet, its backlog window passed) still shows.
 */
export function mergeDesktopPrompts(
  tail: readonly TranscriptTailPrompt[],
  beacon: readonly DesktopPrompt[]
): DesktopPrompt[] {
  const merged: DesktopPrompt[] = tail.map((prompt) => ({
    nonce: prompt.nonce,
    text: prompt.text,
    ...(prompt.anchorId ? { anchorId: prompt.anchorId } : {}),
    ...(prompt.at !== null ? { at: prompt.at } : {})
  }))
  const seen = new Set(tail.map((prompt) => prompt.text))
  for (const prompt of beacon) {
    if (!seen.has(prompt.text)) {
      merged.push(prompt)
    }
  }
  return merged
}

/**
 * The queue as the chat should show it: the rows the screen draws, in the
 * screen's order and with the screen's text, plus any entry the transcript
 * holds that the screen does not (not painted yet, or a screen the parser
 * refused).
 *
 * Why the screen's text and order win where both exist: the queue editor
 * addresses entries by INDEX into the screen's list and checks the tapped
 * text against the row Claude drew (`native-queue-editor.ts`), so a list
 * that led with the transcript's full text broke every edit of a message
 * Claude draws shortened (review, 2026-09-19). A screen row is a shortened
 * form of what was sent, so the match is the same prefix rule the pending
 * echoes use.
 */
export function mergeQueuedMessages(
  screen: readonly string[] | undefined,
  tail: readonly string[]
): string[] {
  const drawn = [...(screen ?? [])]
  const unseen = tail.filter((sent) => !drawn.some((row) => queueRowIsPendingSend(sent, row)))
  return [...drawn, ...unseen]
}
