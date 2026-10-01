/**
 * How many control bytes Claude Code's input will still read as KEYS in one
 * stdin READ.
 *
 * The limit is per READ, not per write. Claude Code 2.1.286 and 2.1.287 turn a
 * control byte into its own key only when the whole read is under 64 bytes
 * (`else if(!o&&u<32&&(a.length<64||u===WZ.BS))` in the input tokenizer, read
 * from the binary 2026-10-01); in a read of 64 or more every control byte stays
 * inside the text run and goes into the input as a literal character. Separate
 * `terminal.send` writes made back to back arrive as ONE read, so cutting a
 * burst into writes of 63 does not keep it under the limit, and a control byte
 * that coalesces with body text is literal too.
 *
 * What was measured, and what it did not show. Against a live Claude Code
 * 2.1.266 at 60 columns on 2026-09-10, ONE write of 63 Ctrl+U emptied a
 * 400-character draft and one of 64 did nothing. That is the per-read rule seen
 * through a single write. It was read as a per-write rule, and the send's 66-byte
 * clear was cut into writes of 63 and 3 on that reading. On 2026-10-01 those two
 * writes coalesced into one read of 66 bytes: the 66 control bytes were typed
 * into the input between the draft and the body, and Claude Code, having
 * stripped them, did not submit ("Removed 67 invisible characters · review and
 * press Enter to send").
 *
 * So no chunk size is safe by counting. The chat's send no longer relies on this
 * constant: it sizes ONE clear write from the screen, stays under the limit, and
 * reads the input back before typing (mobile-native-chat-verified-clear.ts). The
 * callers that still split on it (the Codex send's clear, the image paste's
 * heal, the queue editor, the draft mirror's erase run) are best effort, which
 * is why the queue editor reads back between its passes.
 *
 * Exclusive: a write must be strictly shorter than this.
 */
export const AGENT_TUI_MAX_KEY_WRITE_BYTES = 64

/**
 * The clear burst, split into writes that are each under the limit.
 *
 * Each chunk goes out as its own `terminal.send`. That does NOT make them
 * separate reads (see above), so it narrows the chance of a coalesced read
 * rather than removing it. A short burst, the common case, stays a single write
 * and costs the send nothing.
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
