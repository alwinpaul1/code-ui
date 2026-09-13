/**
 * Prompts Claude has already accepted, read off its own screen.
 *
 * Why this exists: a prompt submitted while a turn is running is written to the
 * transcript as an `attachment`/`queued_command` record, and Orca's reader has
 * no code for that type at all, so the phone never receives it (verified
 * against the desktop bundle, 2026-09-13). The agent's queue is one witness,
 * but a prompt taken between two tool calls can be absorbed before the phone's
 * one-second screen poll ever sees the queue box. Once absorbed, Claude prints
 * the prompt into its scrollback as a `>` row, and that row stays on screen for
 * a while — long enough to be read.
 *
 * This is a mirror, never a source of truth: the rows are wrapped to the
 * terminal's width, so the text can come back re-wrapped. It is only ever used
 * for prompts the transcript does not carry, and it is dropped the moment the
 * transcript does.
 *
 * Verified against Claude Code 2.1.270.
 */

/** Claude marks an accepted prompt with this at column 0. */
const PROMPT_ROW = /^\s{0,2}[>❯›]\s+(.*)$/
/** A wrapped continuation of the row above it. */
const CONTINUATION = /^\s{2,}(\S.*)$/
/** The live composer sits at the very bottom; never read it as a sent prompt. */
const COMPOSER_TAIL_ROWS = 6

export function sentPromptsFromScreen(screen: readonly string[]): string[] {
  const prompts: string[] = []
  const limit = Math.max(0, screen.length - COMPOSER_TAIL_ROWS)
  let index = 0
  while (index < limit) {
    const head = PROMPT_ROW.exec(screen[index] ?? '')
    if (!head) {
      index += 1
      continue
    }
    const parts = [head[1] ?? '']
    let cursor = index + 1
    let blanks = 0
    while (cursor < screen.length) {
      const line = screen[cursor] ?? ''
      if (line.trim().length === 0) {
        blanks += 1
        cursor += 1
        continue
      }
      const more = CONTINUATION.exec(line)
      if (!more) {
        break
      }
      parts.push(...Array.from({ length: Math.min(blanks, 1) }, () => ''), more[1] ?? '')
      blanks = 0
      cursor += 1
    }
    const text = joinWrappedRows(parts)
    if (text.length > 0) {
      prompts.push(text)
    }
    index = cursor
  }
  return prompts
}

/** Rejoin what the terminal wrapped: a blank row is a real paragraph break,
 *  every other row continues the sentence above it. */
function joinWrappedRows(parts: readonly string[]): string {
  let out = ''
  for (const part of parts) {
    if (part === '') {
      out += '\n'
      continue
    }
    out += out.length === 0 || out.endsWith('\n') ? part : ` ${part}`
  }
  return out.trim()
}
