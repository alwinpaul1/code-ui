/**
 * How many control bytes an agent's input will still read as KEYS in one write.
 *
 * Measured against a live Claude Code 2.1.266 at 60 columns on 2026-09-10,
 * driving a real composer through tmux: a single write of 63 Ctrl+U emptied a
 * 400-character draft, and 64 did nothing whatsoever — the draft stood
 * untouched and the bytes were gone. Composition made no difference; a mixed
 * Ctrl+U/Ctrl+K burst behaved the same way at the same boundary, so this is a
 * chunk-size rule, not a key-sequence one.
 *
 * The phone hit it for real. A send whose clear burst had grown to 74 bytes
 * left the draft standing and the bytes were carried into the message: the
 * transcript received the text, 37 literal kill-line bytes, 37 literal
 * kill-to-end bytes, and the text again, submitted as one turn.
 *
 * Exclusive: a write must be strictly shorter than this.
 */
export const AGENT_TUI_MAX_KEY_WRITE_BYTES = 64

/**
 * The clear burst, split into writes the agent will still read as keys.
 *
 * Each chunk goes out as its own `terminal.send`, so the agent reads them as
 * separate chunks rather than one paste. A short burst — the common case —
 * stays a single write and costs the send nothing.
 */
export function splitAgentTuiClearWrites(clearInput: string): string[] {
  if (clearInput.length === 0) {
    return []
  }
  const size = AGENT_TUI_MAX_KEY_WRITE_BYTES - 1
  const writes: string[] = []
  for (let start = 0; start < clearInput.length; start += size) {
    writes.push(clearInput.slice(start, start + size))
  }
  return writes
}
