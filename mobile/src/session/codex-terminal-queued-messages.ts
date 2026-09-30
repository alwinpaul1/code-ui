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

// Codex draws the preview's headers at column 0 (pending_input_preview.rs); an indented one is quoted
// in an answer. Whole-row, so a wrapped first row is matched once its tail is joined on.
const HEADER =
  /^(?:• )?(?:Queued follow-up inputs|Messages to be submitted at end of turn|Messages to be submitted after next tool call(?: \(press.*)?)\s*$/
const STEER_HEADER = /^(?:• )?Messages to be submitted after next tool call\b/
// The first row of a header, wrapped or not: where the span walk may stop.
const HEADER_START = /^(?:• )?(?:Queued follow-up inputs|Messages to be submitted)/
// A row whose indented tail rows are joined on before HEADER is tried.
const WRAPPED_HEADER_START = /^(?:• )?(?:Queued|Messages)\b/
/** Codex draws its composer with `›`; a `>` or `❯` line is quoted text or a shell prompt. */
export const CODEX_COMPOSER_ROW = /^\s*›\s/

/** Where the pending-input preview blocks that end at `composer` begin (`composer` when none). Codex's
 *  bottom pane draws the status row, a blank line, the preview, then the composer
 *  (codex-rs/tui/src/bottom_pane/mod.rs), so the live preview is the run of header, entry, indented
 *  and blank rows directly above it. Only a block that opens with a header at column 0 counts, so
 *  indented prose above the composer is not mistaken for one. */
export function codexPendingPreviewStart(lines: readonly string[], composer: number): number {
  let start = composer
  for (let i = composer - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? ''
    if (HEADER_START.test(line)) {
      start = i
    } else if (line.trim() !== '' && !/^\s{2,}\S/.test(line) && !/^\s*↳/.test(line)) {
      break
    }
  }
  return start
}

/** Reads only the live preview: the span directly above the last composer row, headers at column 0.
 *  An idle answer quoting the preview read as a queued message that did not exist (review,
 *  2026-09-30). With no composer on screen the whole screen is read, headers still at column 0: Codex
 *  draws the preview only above its composer, so that is a pager, a `cat`ed transcript or a test
 *  fixture cut short, and several fixtures (codex-terminal-queued-messages.test.ts,
 *  mobile-chat-running-tool-in-prompt-bubble.test.ts) still pin a composer-less preview. */
function scanCodexPendingInputPreview(lines: readonly string[]) {
  const groups: string[][] = []
  const rows = new Set<number>()
  const steerHeaders = new Set<number>()
  const composer = lines.findLastIndex((line) => CODEX_COMPOSER_ROW.test(line))
  const end = composer === -1 ? lines.length : composer
  let entries: string[] | null = null
  for (let i = composer === -1 ? 0 : codexPendingPreviewStart(lines, composer); i < end; i++) {
    const at = i
    const line = lines[i]!
    let heading = line
    if (WRAPPED_HEADER_START.test(line)) {
      while (i + 1 < end && /^ {2}[^ ↳]/.test(lines[i + 1]!)) {
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
