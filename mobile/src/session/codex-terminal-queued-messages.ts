/** Codex's PendingInputPreview uses explicit section headers and arrow entries.
 * Source: openai/codex, codex-rs/tui/src/bottom_pane/pending_input_preview.rs.
 * Keep its ellipsis: the terminal exposes a preview, not the full queue payload.
 */
export function codexQueuedMessagesFromScreen(lines: readonly string[]): string[] {
  return scanCodexPendingInputPreview(lines).groups.flat()
}

/**
 * The preview as codexQueuedMessagesFromScreen reads it, and whether the read
 * can say the queue is empty: it found an entry, or a `›` row is on screen.
 * Codex draws the preview only over its composer, so with no `›` row at all
 * nothing on screen says what is queued. A `›` row is not always the composer
 * (a sent prompt, a popup's or an approval's selected row), so a dialog over
 * the composer is told by mobile-terminal-queue-read.ts, not here.
 */
export function codexQueueReadFromScreen(lines: readonly string[]): { entries: string[]; readable: boolean } {
  const entries = codexQueuedMessagesFromScreen(lines)
  return { entries, readable: entries.length > 0 || lines.some((line) => CODEX_COMPOSER_ROW.test(line)) }
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

// A suggestion popup's rows at column 0 (codex-rs rust-v0.158.0 bottom_pane): the selected row, which
// command_popup.rs, file_search_popup.rs and the mention popups mark with the composer's own `› `;
// the arrows of a scrolled list (skill_popup_scrolled.snap); and the "no matches" placeholder
// (selection_popup_common.rs render_rows_inner). Every other popup row is indented.
const POPUP_SELECTED_ROW = /^›\s/
const POPUP_EDGE_ROW = /^(?:[↑↓]|no matches)\s*$/
// An indented row that is not a preview entry: a popup's unselected items, their wrapped
// descriptions, its title, tabs and key hint.
const INDENTED_NON_ENTRY_ROW = /^\s{2,}[^\s↳]/

/** The first row of the slash-command or @-mention popup directly above `composer`, or `composer`
 *  when there is none. Codex 0.158 draws the popup ABOVE its composer whenever a status row or the
 *  preview is shown (bottom_pane/mod.rs as_renderable_with_options turns
 *  CommandPopupPlacement::Overlay into AboveComposer), so it sits between the preview and the
 *  composer, and its selected `› ` row stopped the preview walk: the queue read [] while the popup
 *  was open (review, 2026-09-30). One popup has one selected row, so a second `›` row going up is the
 *  conversation and ends the walk. Codex 0.153.4 draws the popup below the composer with no `›`, so
 *  none is found there. */
function codexPopupStart(lines: readonly string[], composer: number): number {
  let marker = -1
  let selected = false
  for (let i = composer - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? ''
    if (POPUP_SELECTED_ROW.test(line) && !selected) {
      selected = true
      marker = i
    } else if (POPUP_EDGE_ROW.test(line)) {
      marker = i
    } else if (line.trim() !== '' && !INDENTED_NON_ENTRY_ROW.test(line)) {
      break
    }
  }
  if (marker === -1) {
    return composer
  }
  // The popup's rows above its highest column-0 row: unselected items, a mention popup's title,
  // tabs and query. A blank row or a preview entry ends them.
  let top = marker
  while (top > 0 && INDENTED_NON_ENTRY_ROW.test(lines[top - 1] ?? '')) {
    top -= 1
  }
  return top
}

/** Where the pending-input preview blocks that end at `composer` begin (the popup's first row, or
 *  `composer`, when none). Codex's bottom pane draws the status row, a blank line, the preview, then
 *  the composer (codex-rs/tui/src/bottom_pane/mod.rs), with any open popup between the preview and
 *  the composer (codexPopupStart), so the live preview is the run of header, entry, indented and
 *  blank rows directly above the popup. Only a block that opens with a header at column 0 counts, so
 *  indented prose above the composer is not mistaken for one. */
export function codexPendingPreviewStart(lines: readonly string[], composer: number): number {
  const popup = codexPopupStart(lines, composer)
  let start = popup
  for (let i = popup - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? ''
    if (HEADER_START.test(line)) {
      start = i
    } else if (line.trim() !== '' && !/^\s{2,}\S/.test(line) && !/^\s*↳/.test(line)) {
      break
    }
  }
  return start
}

/** Reads only the live preview: the span directly above the last composer row (and above any popup
 *  open over it, codexPopupStart), headers at column 0.
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
  // An entry's wrapped rows sit under its text, two columns past its `↳` (pending_input_preview.rs:
  // "  ↳ " then a four-space subsequent indent). A popup's unselected rows are indented two, so under
  // a pending steer, which draws no edit hint to end it, they were read as the entry's next line.
  let entryIndent = 0
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
    const entry = /^(\s*)↳ (.*)$/.exec(line)
    if (entry) {
      entries.push(entry[2]!.trimEnd())
      entryIndent = entry[1]!.length
      rows.add(at)
    } else if (/edit last queued message\s*$/.test(line)) {
      entries = null
      rows.add(at)
    } else if (entries.length && line.trim() !== '' && indentOf(line) >= entryIndent + 2) {
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

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}
