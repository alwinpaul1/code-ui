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
  // A status copy held back (`heldBack`, agent-status-prompts.ts) still drops
  // the beacon's: that has only the row it was typed after, and while the row
  // is on a page not loaded it waits for it at the tail (2026-09-26).
  const seen = new Set(status.map((prompt) => prompt.text))
  for (const prompt of beacon) {
    if (!seen.has(prompt.text) && !isSubagentMessagePrompt(prompt) && !isCrossSessionMessagePrompt(prompt.text)) {
      merged.push(prompt)
    }
  }
  return merged
}
