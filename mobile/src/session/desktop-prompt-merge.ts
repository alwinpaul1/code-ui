import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import type { DesktopPrompt } from './agent-hud-beacon'
import { isSubagentMessagePrompt } from './mobile-native-chat-agent-messages'
import { isCrossSessionMessagePrompt } from './claude-peer-message-frames'

/**
 * The tab status's prompts and the beacon's, as one list for the chat.
 *
 * Both can carry the same message: a phone-launched session beacons a
 * desktop prompt from its UserPromptSubmit hook AND Orca's own hook puts the
 * same prompt on the tab status. The status copy wins — it carries the time
 * the prompt was taken, which the chat anchors on — and the beacon's copy
 * is dropped when its text matches one. A beacon prompt with no status twin
 * (a host that publishes no status) still shows.
 *
 * A subagent's message is dropped from the beacon: Claude Code fires the same
 * hook for its `<agent-message …>`, each desktop prompt is drawn as the user's
 * own bubble, and the message is drawn from the beacon as its own row instead
 * (mobile-native-chat-agent-messages.ts). Only that exact wrapper, never the
 * shared harness classifier: this is the one path a prompt typed mid-turn
 * reaches the phone by, and that classifier matches by a leading word or tag
 * ("A message arrived from …", a quoted `<system-reminder>`), so a person's
 * prompt that starts that way was drawn nowhere (review of 2026-09-26).
 * Another session's message is dropped too, told by the harness's opener line
 * and the `<cross-session-message>` envelope under it: the screen draws it as
 * the peer bubble, and the beacon's copy drew a raw XML bubble over it (review
 * of 2026-09-27). A lead's `<teammate-message>` in a teammate session stays a
 * desktop prompt, the user's bubble a landed one gets (teammateTask).
 */
export function mergeDesktopPrompts(
  status: readonly DesktopPrompt[],
  beacon: readonly DesktopPrompt[]
): DesktopPrompt[] {
  const twins = foldedTwins(status, beacon)
  const twinOf = new Map([...twins].map(([prompt, copy]) => [copy, prompt]))
  // A status copy the field cut stands for the message as typed: its twin's
  // words (up to 2,000 bytes, `cut` when the hook shortened them). Drawn and
  // remembered as the 200-character cut, it matched neither the queue box's
  // whole reading of the message nor its row, and a message the chat closed
  // on before the box listed it came back as two, cut and whole (W1 of the
  // review of fix/midturn-gaps, 2026-09-29). The status copy keeps its nonce
  // and its time; only the words come from the twin.
  const merged: DesktopPrompt[] = status.map((copy) => {
    const twin = twinOf.get(copy)
    return twin !== undefined && copy.cut === true && twin.text.length > copy.text.length
      ? { ...copy, text: twin.text, cut: twin.cut === true }
      : copy
  })
  // The two copies of one message are told by the status's own folding: it
  // keeps a prompt on one line and cuts it at 200 characters
  // (normalizePromptField), while the beacon keeps the words as typed, up to
  // 2,000 bytes. Matched on exact text, a multi-line or long prompt kept both
  // and was drawn twice (pre-merge review of 06911823). A folded match stands
  // for ONE beacon copy, the one the phone read nearest it: two long messages
  // that agree for 200 characters fold to one status text, and dropping every
  // copy that folded to it hid the second, which as a mid-turn message has no
  // row (review of 004ce958). A status copy held back (`heldBack`,
  // agent-status-prompts.ts) drops its twin the same way, a desk resend's own
  // copy included, whose anchor could place it (combined review of 30c94116):
  // the held copy can be placed later, once the rows show a harness message
  // carried it (desk-prompt-harness-turns.ts, after this merge), and a twin
  // let through would then draw the message twice.
  const seen = new Set(status.map((prompt) => prompt.text))
  for (const prompt of beacon) {
    const twin = seen.has(prompt.text) || twins.has(prompt)
    if (!twin && !isSubagentMessagePrompt(prompt) && !isCrossSessionMessagePrompt(prompt.text)) {
      merged.push(prompt)
    }
  }
  return merged
}

/**
 * The beacon copies a status copy stands for by the status's folding, one
 * each, nearest pair first by when the phone read them, each with the status
 * copy it pairs with. Taken from the beacon
 * side in list order, an older message of the same first 200 characters took
 * the status copy after a remount, and the message the status carried was
 * kept beside it, drawn twice (review of 08813139).
 */
function foldedTwins(status: readonly DesktopPrompt[], beacon: readonly DesktopPrompt[]): Map<DesktopPrompt, DesktopPrompt> {
  const pairs: { copy: DesktopPrompt; prompt: DesktopPrompt; distance: number; order: number }[] = []
  beacon.forEach((prompt, index) => {
    const folded = normalizePromptField(prompt.text)
    for (const copy of status) {
      if (copy.text === folded && folded !== prompt.text && !arrivedAfter(prompt, copy)) {
        const distance =
          typeof copy.seenAt === 'number' && typeof prompt.seenAt === 'number' ? Math.abs(copy.seenAt - prompt.seenAt) : Number.MAX_VALUE
        pairs.push({ copy, prompt, distance, order: index })
      }
    }
  })
  pairs.sort((a, b) => a.distance - b.distance || a.order - b.order)
  const paired = new Set<DesktopPrompt>()
  const twins = new Map<DesktopPrompt, DesktopPrompt>()
  for (const { copy, prompt } of pairs) {
    if (!paired.has(copy) && !twins.has(prompt)) {
      paired.add(copy)
      twins.set(prompt, copy)
    }
  }
  return twins
}

/** How long after the phone read a status copy the hook's copy of the same
 *  submission can still reach it: the two travel separate streams (the tab
 *  status and the terminal's bytes), a moment apart as a rule. */
const TWIN_LAG_MS = 30_000

/**
 * Whether a hook copy reached the phone well after it read the status copy,
 * which makes it a later submission and never that copy's twin. The status
 * reader makes a copy only when the pane's prompt changes, so a second
 * message that shares the first's first 200 characters, or its words, gets
 * none of its own. Paired with the first's status copy because the phone
 * never got the first's hook copy, it was dropped, and the first was drawn
 * with the second's words in the first's place (review of W1's fix,
 * 2026-09-29). A copy with no arrival time pairs as before.
 */
function arrivedAfter(prompt: DesktopPrompt, copy: DesktopPrompt): boolean {
  return typeof prompt.seenAt === 'number' && typeof copy.seenAt === 'number' && prompt.seenAt - copy.seenAt > TWIN_LAG_MS
}
