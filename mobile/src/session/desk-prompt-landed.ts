import type { DesktopPrompt } from './agent-hud-beacon'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeNativeChatUserText } from '../../../src/shared/native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import { withShortSkillToken } from './mobile-native-chat-command-turns'
import { withoutPasteWrappers } from './mobile-native-chat-paste-wrapper'
import { photosOnlyPrompt } from './mobile-native-chat-image-transcript-markers'
import { teammateTask } from './mobile-native-chat-peer-messages'
import { hookAnchorOf, joinedLineBetween, ownedByLaterSubmission, placeOfCopy, rowOwners, withoutLateHookTwins } from './desk-prompt-row-owners'

/**
 * Which desk prompts the transcript already shows. Moved out of
 * use-desktop-prompt-echoes.ts, which draws the ones left, when this rule
 * took the row the hook names into account (2026-09-30).
 */

/** Drop prompts the transcript already shows: a prompt submitted while the
 *  agent was idle IS written as a user turn, and would otherwise appear
 *  twice. Compared on the same key every other witness uses, so a transcript
 *  row carrying `[Image #1]` markers or different wrapping still counts. */
export function withoutLandedDesktopPrompts(
  prompts: readonly DesktopPrompt[],
  folded: readonly NativeChatMessage[],
  alsoShown: readonly string[] = [],
  /** The transcript as read, `[Image #N]` markers and all: a photo sent with
   *  no words has no key, and lands as the row of exactly its markers
   *  (Claude Code numbers photos through a session). */
  raw: readonly NativeChatMessage[] = []
): DesktopPrompt[] {
  prompts = withoutLateHookTwins(prompts, raw)
  // The rows as read, and what the agent's queue box lists (fourth review: a
  // desk photo of no words drew in the box and as a bubble above it).
  const landedMarkers = new Set(
    [
      ...raw.map((message) =>
        message.role === 'user' ? message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join(' ') : ''
      ),
      ...alsoShown
    ].flatMap((text) => (photosOnlyPrompt(text) > 0 ? [markersOf(text)] : []))
  )
  const seen = [
    ...folded
      .filter((message) => message.role === 'user')
      .map((message) => ({
        text: message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join(''),
        rowId: message.id as string | undefined
      })),
    // What the queue box lists has no row: it is the box as read now, where a
    // message still queued is drawn, and a copy of its words is drawn there
    // rather than as a bubble above it, wherever an earlier turn of the same
    // words sits (desk-prompt-earlier-turn-words.test.ts).
    ...alsoShown.map((text) => ({ text, rowId: undefined }))
  ]
    .map((entry) => ({ key: landedKey(entry.text), rowId: entry.rowId }))
    .filter((entry) => entry.key.length > 0)
  // A row a later hook submission of the same words owns is that
  // submission's, not an earlier copy's (desk-prompt-row-owners.ts).
  const owners = rowOwners(prompts, raw, landedKey)
  const position = new Map(raw.map((message, index) => [message.id, index]))
  return prompts.filter((prompt) => {
    if (photosOnlyPrompt(prompt.text) > 0) {
      return !landedMarkers.has(markersOf(prompt.text))
    }
    const key = landedKey(prompt.text)
    const place = owners.size > 0 ? placeOfCopy(prompt, raw) : null
    // The row the hook says the prompt was typed after (`at=`), when the chat
    // holds it. A row at or before it was written before the prompt, so it is
    // an earlier turn of the same words, never this copy's landing: a
    // mid-turn "keep going" gets no row of its own, and the earlier turn's
    // row dropped its only copy (2026-09-30). Named nowhere, or on a page not
    // loaded (every row held is then after it), any row of its words lands
    // it, as before.
    const hookAnchor = hookAnchorOf(prompt)?.anchorId
    const typedAfter = hookAnchor === undefined ? undefined : position.get(hookAnchor)
    // A prompt the hook had to shorten can only ever be matched as a prefix
    // of the row that landed. The hook says when it shortened one; guessing
    // from the length was wrong whenever escapes or multibyte text moved the
    // boundary (2026-09-13).
    return !seen.some(
      (other) =>
        (other.key === key || (prompt.cut === true && key.length > 0 && other.key.startsWith(key))) &&
        !(typedAfter !== undefined && other.rowId !== undefined && (position.get(other.rowId) ?? Infinity) <= typedAfter) &&
        !(
          place !== null &&
          other.rowId !== undefined &&
          ownedByLaterSubmission(owners.get(other.rowId), place) &&
          !joinedLineBetween(raw, place.position, raw.findIndex((message) => message.id === other.rowId), key, landedKey, owners)
        )
    )
  })
}

function markersOf(text: string): string {
  return (text.match(/\[Image #\d+\]/g) ?? []).join(' ')
}

/** The key a hook prompt is retired on. Painted, because `alsoShown` can hold
 *  a restored screen reading (no backticks); short-token, because the surfaced
 *  row of a plugin skill is `/name`, not `/plugin:name`; a lead's message in a
 *  teammate session by its words, because its row is surfaced as them and
 *  the hook's copy kept the wrapper, so the copy never retired and the
 *  follow-up drew twice (teammateTask; review of 2026-09-27). */
export function landedKey(text: string): string {
  const words = teammateTask(text)?.text ?? text
  return normalizeNativeChatUserText(asPaintedPrompt(withShortSkillToken(withoutPasteWrappers(words))))
}
