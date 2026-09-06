/** Codex's PendingInputPreview uses explicit section headers and arrow entries.
 * Source: openai/codex, codex-rs/tui/src/bottom_pane/pending_input_preview.rs.
 * Keep its ellipsis: the terminal exposes a preview, not the full queue payload.
 */
export function codexQueuedMessagesFromScreen(lines: readonly string[]): string[] {
  const header =
    /^\s*• (?:Queued follow-up inputs|Messages to be submitted at end of turn|Messages to be submitted after next tool call(?: \(press.*)?)\s*$/
  const groups: string[][] = []
  let entries: string[] | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    let heading = line
    if (/^\s*• (?:Queued|Messages)\b/.test(line)) {
      while (i + 1 < lines.length && /^ {2}[^ ↳]/.test(lines[i + 1]!)) {
        heading += ' ' + lines[++i]!.trim()
      }
    }
    if (header.test(heading)) {
      entries = []
      groups.push(entries)
      continue
    }
    if (!entries) {
      continue
    }
    const entry = /^\s{2}↳ (.*)$/.exec(line)
    if (entry) {
      entries.push(entry[1]!.trimEnd())
    } else if (/edit last queued message\s*$/.test(line)) {
      entries = null
    } else if (/^\s{4}\S/.test(line) && entries.length) {
      entries[entries.length - 1] += '\n' + line.trim()
    } else if (/^\s{2}\S/.test(line) && !entries.length) {
      // The pending-steer header's explanatory hint can wrap before the first entry.
      continue
    } else if (line.trim()) {
      entries = null
    }
  }
  return groups.flat()
}
