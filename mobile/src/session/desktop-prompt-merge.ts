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
  const merged: DesktopPrompt[] = [...status]
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
  const paired = new Set<DesktopPrompt>()
  const foldedTwin = (prompt: DesktopPrompt): boolean => {
    const folded = normalizePromptField(prompt.text)
    const distance = (copy: DesktopPrompt) =>
      typeof copy.seenAt === 'number' && typeof prompt.seenAt === 'number' ? Math.abs(copy.seenAt - prompt.seenAt) : Number.MAX_VALUE
    const nearest = status
      .filter((copy) => copy.text === folded && !paired.has(copy))
      .reduce<DesktopPrompt | undefined>((best, copy) => (best === undefined || distance(copy) < distance(best) ? copy : best), undefined)
    if (nearest !== undefined) {
      paired.add(nearest)
    }
    return nearest !== undefined
  }
  for (const prompt of beacon) {
    const twin = seen.has(prompt.text) || foldedTwin(prompt)
    if (!twin && !isSubagentMessagePrompt(prompt) && !isCrossSessionMessagePrompt(prompt.text)) {
      merged.push(prompt)
    }
  }
  return merged
}
