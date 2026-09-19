import type { DesktopPrompt } from './agent-hud-beacon'

/**
 * The tab status's prompts and the beacon's, as one list for the chat.
 *
 * Both can carry the same message: a phone-launched session beacons a
 * desktop prompt from its UserPromptSubmit hook AND Orca's own hook puts the
 * same prompt on the tab status. The status copy wins — it carries the time
 * the prompt was taken, which the chat anchors on — and the beacon's copy
 * is dropped when its text matches one. A beacon prompt with no status twin
 * (a host that publishes no status) still shows.
 */
export function mergeDesktopPrompts(
  status: readonly DesktopPrompt[],
  beacon: readonly DesktopPrompt[]
): DesktopPrompt[] {
  const merged: DesktopPrompt[] = [...status]
  const seen = new Set(status.map((prompt) => prompt.text))
  for (const prompt of beacon) {
    if (!seen.has(prompt.text)) {
      merged.push(prompt)
    }
  }
  return merged
}
