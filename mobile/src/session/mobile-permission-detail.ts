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

// Only the box-drawing gutter the TUI paints. An ASCII pipe is far more likely
// to be a shell pipe inside the command than a gutter (2026-09-14 review).
const GUTTER = /^\s*│\s?/
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
  // Deliberately NOT requiring the gutter lines to be contiguous: in the real
  // captured body the TUI gutters the command AND the hook's reason, with the
  // step description sitting between them as plain prose (2026-09-14). A
  // reviewer proposed refusing a broken gutter, on the theory that a command
  // with a literal newline leaves its continuation ungutttered — the capture
  // shows the TUI gutters every line of the command, so that would have thrown
  // away the real shape to guard a hypothetical one.
  const fromGutter = gutter.join('\n').trim()
  const resolved = command?.trim() || fromGutter || null
  const text = prose.join('\n').trim()
  // Prose that merely repeats the command is not worth a second block.
  const dense = (value: string) => value.replace(/\s+/g, '')
  const described =
    text.length > 0 && (!resolved || !dense(resolved).includes(dense(text))) ? text : null
  // Never leave the card with a title and no body: a summary of nothing but the
  // tip and the proceed line dropped to empty (2026-09-14 review). Falling back
  // to what the agent sent is better than showing the user nothing to read.
  const description = described ?? (resolved ? null : ((detail ?? '').trim() || null))
  return { command: resolved, description }
}
