/**
 * A slash command's own output, drawn as the Claude app draws it: not Claude's reply but the
 * command's, a rule down its left side and the words in the dimmed ink (com.anthropic.claude
 * 1.261009.20: the text part's command-output flag, rhu.k rhu.java:1639-1657, set by alt.g
 * alt.java:59-69; drawn by mw20.java:181-193 with vb20.j vb20.java:1733-1736, a 2 dp line and
 * 8 dp before the text). Claude Code sends it as an `assistant` event with `local_command_source`
 * (fixtures/ccr-local-command-forked-skill-2026-10-15.ts).
 */
export const LOCAL_COMMAND_PRESENTATION = 'local-command'

/** A tag with its closing tag; its contents are kept. */
const PAIRED_TAG = /<([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?>([\s\S]*?)<\/\1>/g

/**
 * The words the Claude app shows for a command's output: a tag such as `<forked-skill-launch>`
 * is not drawn and its contents are (its Markdown does not draw HTML; the launch's JSON shows
 * raw on its screen, 2026-10-15). Only a tag that is closed is taken out, so a lone placeholder
 * ("Usage: /model <name>") keeps its brackets rather than losing a word.
 */
export function localCommandDrawnText(text: string): string {
  let previous: string
  let current = text
  // Until nothing changes: a tag inside another is unwrapped on the next pass.
  do {
    previous = current
    current = current.replace(PAIRED_TAG, '$2')
  } while (current !== previous)
  return current.trim()
}

/**
 * Whether an `assistant` event is a command's output the app marks as such: it names its command
 * output (`local_command_source`), carries no error, is not an API error, its model is Claude
 * Code's `<synthetic>`, and the output was not stderr (the app leaves that as ordinary text).
 */
export function isLocalCommandOutput(payload: Record<string, unknown>, model: unknown): boolean {
  const source = payload.local_command_source
  return (
    typeof source === 'string' &&
    payload.error == null &&
    payload.isApiErrorMessage !== true &&
    payload.is_api_error_message !== true &&
    model === '<synthetic>' &&
    !source.startsWith('<local-command-stderr>')
  )
}
