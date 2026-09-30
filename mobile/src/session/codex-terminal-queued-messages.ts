/** Codex's PendingInputPreview uses explicit section headers and arrow entries.
 * Source: openai/codex, codex-rs/tui/src/bottom_pane/pending_input_preview.rs.
 * Keep its ellipsis: the terminal exposes a preview, not the full queue payload.
 */
export function codexQueuedMessagesFromScreen(lines: readonly string[]): string[] {
  return scanCodexPendingInputPreview(lines).groups.flat()
}

/** The rows of Codex's pending-input preview, by index, from the same scan the
 *  queue reader uses: every section header (wrapped rows too), entry, entry
 *  continuation, "…" overflow and edit hint. `steerHeaders` holds the first
 *  row of each "Messages to be submitted after next tool call" header: Codex
 *  keeps a pending steer only while a turn runs. */
export function codexPendingInputPreviewRows(lines: readonly string[]): {
  rows: ReadonlySet<number>
  steerHeaders: ReadonlySet<number>
} {
  const { rows, steerHeaders } = scanCodexPendingInputPreview(lines)
  return { rows, steerHeaders }
}

const HEADER =
  /^\s*(?:• )?(?:Queued follow-up inputs|Messages to be submitted at end of turn|Messages to be submitted after next tool call(?: \(press.*)?)\s*$/
const STEER_HEADER = /^\s*(?:• )?Messages to be submitted after next tool call\b/

function scanCodexPendingInputPreview(lines: readonly string[]) {
  const groups: string[][] = []
  const rows = new Set<number>()
  const steerHeaders = new Set<number>()
  let entries: string[] | null = null
  for (let i = 0; i < lines.length; i++) {
    const at = i
    const line = lines[i]!
    let heading = line
    if (/^\s*(?:• )?(?:Queued|Messages)\b/.test(line)) {
      while (i + 1 < lines.length && /^ {2}[^ ↳]/.test(lines[i + 1]!)) {
        heading += ' ' + lines[++i]!.trim()
      }
    }
    if (HEADER.test(heading)) {
      entries = []
      groups.push(entries)
      for (let row = at; row <= i; row++) {
        rows.add(row)
      }
      if (STEER_HEADER.test(heading)) {
        steerHeaders.add(at)
      }
      continue
    }
    if (!entries) {
      continue
    }
    const entry = /^\s*↳ (.*)$/.exec(line)
    if (entry) {
      entries.push(entry[1]!.trimEnd())
      rows.add(at)
    } else if (/edit last queued message\s*$/.test(line)) {
      entries = null
      rows.add(at)
    } else if (/^\s{2,}\S/.test(line) && entries.length) {
      entries[entries.length - 1] += '\n' + line.trim()
      rows.add(at)
    } else if (/^\s{2}\S/.test(line) && !entries.length) {
      // The pending-steer header's explanatory hint can wrap before the first entry.
      rows.add(at)
      continue
    } else if (line.trim()) {
      entries = null
    }
  }
  return { groups, rows, steerHeaders }
}
