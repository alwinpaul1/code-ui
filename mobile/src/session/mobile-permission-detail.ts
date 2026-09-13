/**
 * Splits the agent's approval summary into the command it wants to run and the
 * words worth reading beside it.
 *
 * The summary is the TUI's whole prompt body. On the phone that came through as
 * one monospace slab: an auto-mode tip, the command echoed behind a `│` gutter,
 * the step's description, the hook's reason, and "Do you want to proceed?" —
 * where the Claude app shows a compact block holding the command alone
 * (screenshots, 2026-09-14). The tip is also wrong here now, since the phone no
 * longer offers a switch-to-auto-mode choice.
 */
export type PermissionDetailParts = {
  /** The command, gutter stripped, one entry per line as the agent drew it. */
  command: string | null
  /** What is left worth reading: the step's own description, or null. */
  description: string | null
}

const GUTTER = /^\s*[│|]\s?/
const AUTO_MODE_TIP = /^\s*Tip:.*auto mode/i
const PROCEED = /^\s*(?:Do you want to proceed\??|Proceed\??)\s*$/i

export function splitPermissionDetail(
  detail: string | undefined,
  command: string | undefined
): PermissionDetailParts {
  const lines = (detail ?? '').split('\n')
  const gutter: string[] = []
  const prose: string[] = []
  for (const line of lines) {
    if (AUTO_MODE_TIP.test(line) || PROCEED.test(line)) {
      continue
    }
    if (GUTTER.test(line)) {
      gutter.push(line.replace(GUTTER, '').trimEnd())
      continue
    }
    if (line.trim().length > 0) {
      prose.push(line.trim())
    }
  }
  const fromGutter = gutter.join('\n').trim()
  const resolved = command?.trim() || fromGutter || null
  const text = prose.join('\n').trim()
  // Prose that merely repeats the command is not worth a second block.
  const dense = (value: string) => value.replace(/\s+/g, '')
  const description =
    text.length > 0 && (!resolved || !dense(resolved).includes(dense(text))) ? text : null
  return { command: resolved, description }
}
