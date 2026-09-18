/**
 * The fenced block "Ask about this screen" appends to the composer, from a
 * terminal's own rendered screen lines (VS Code extension 2.1.275's "Send
 * terminal output to Claude" parity).
 *
 * A terminal's screen is padded to its full row count, so a short-lived
 * command leaves blank rows below the real content — trailing blanks are
 * trimmed. Leading blanks are kept: a screen that has just started filling
 * (prompt at the top, blank below) has its content at the top, not padding.
 *
 * `null` means there is nothing to send — an empty screen, or one that is
 * blank end to end. The caller reads this as "disabled": no RPC reply ever
 * turns into an appended block.
 */
export function buildTerminalScreenFenceBlock(lines: readonly string[]): string | null {
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') {
    end -= 1
  }
  if (end === 0) {
    return null
  }
  return ['```', ...lines.slice(0, end), '```'].join('\n')
}
