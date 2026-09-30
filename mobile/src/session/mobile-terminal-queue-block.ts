/**
 * Where the agent's queue box is on its screen: the hints that close it, the
 * send-now row, and the rows that bound it. Shared by the queue reader
 * (mobile-terminal-queued-messages.ts) and the peer-row reader
 * (mobile-terminal-peer-notices.ts), which leaves the box out.
 */

/** Verified against Claude Code 2.1.263. Two different queue footers exist:
 * the legacy whole-queue recall, and the per-message selector that only appears
 * when CLAUDE_CODE_KB_COHESION_FIXES is set in the agent's environment.
 * Claude Code 2.1.277 keeps the placeholder but redraws the block itself —
 * see `columnZeroQueueEntries`. Claude Code 2.1.283 draws the hints, the block,
 * its send-now row and the layout above the spinner with 2.1.282's code
 * (binaries compared 2026-09-26, not captured live). */
export const QUEUE_HINT =
  /^\s*[❯›>]?\s*Press up to (?:edit queued messages|select a queued message)\b/i
export const SELECTED_HINT = /^\s*[❯›>]?\s*Press Enter to edit the selected message\b/i

/** Claude Code 2.1.277 closes its queue block with this row instead of putting
 *  "Enter to send them immediately" in the composer placeholder. Its presence
 *  is what tells the 2.1.277 shape from a 2.1.263 transcript echo, which draws
 *  a delivered message with the same column-zero marker. The chord differs by
 *  build: "ctrl+x ctrl+s to send now" on 2.1.277, "ctrl+enter to send now" on
 *  2.1.280 (2026-09-23), so any key chord before "to send now" closes it. */
export const SEND_NOW_HINT = /^\s*(?:(?:ctrl|shift|alt|option|opt|cmd|meta)\+\S+\s+)+to send now\s*$/i
/** The working spinner Claude draws between the transcript and the queue:
 *  "✻ Frolicking… (15m 36s · ↓ 56.6k tokens)". The glyph rotates; the
 *  ellipsis after the verb does not. */
export const SPINNER_ROW = /^[^\s❯›>⏺⎿]\s+\S.*…/
/** A tool's own row: its dot, or the `⎿` of its result or hint. Claude Code
 *  2.1.283 draws the dot as "⏺" on macOS and "●" elsewhere (`Fr` in the
 *  binary). */
const TOOL_ROW = /^\s*[⏺●⎿]/

/**
 * A row the legacy queue box (Claude Code 2.1.263 to about 2.1.276) draws
 * between its entries and the composer, not a line of an entry: blank, or a
 * rule of dashes or box characters. Not one at the entries' four-column
 * continuation indent, where a queued message's own line of dashes (a
 * Markdown "---") is drawn: taken for the separator, it was dropped from the
 * message, or, between two entries, ended the scan and lost the older one
 * (2026-09-30). The box's own rules are at column zero in every capture.
 */
export function isLegacyQueueSeparator(line: string): boolean {
  return /^[\s─━—-]*$/.test(line) && !/^ {4,}\S/.test(line)
}

/**
 * The rule that closes the transcript above Claude's input box: a run of "─",
 * or that row with a label in it. The label is the session's name from the
 * banner row (`fv` in Claude Code 2.1.285, `Ub` in 2.1.284) and the fast-mode
 * and ultracode tags from the composer's `borderText`. The real row, captured
 * 2026-09-30 via orca terminal read --screen: 119 x "─", " 1152 ", one "─".
 *
 * Claude builds it as the glyph run (columns - name width - 3), " name", " ─";
 * a tag takes more columns; a name wider than the row is cut with "…" and the
 * row then starts with a space, no glyph before it. So the row is not held to
 * a run length or a label length: it is a run of glyphs (possibly none), a
 * space, a label, and it always ends in " ─", one glyph after a space. Text
 * that ends in words is not a rule. A row of this shape sat where only a bare
 * rule was skipped, and the whole queue was refused, so the chat drew a queued
 * message as sent.
 */
export function isPromptRule(line: string): boolean {
  return /^[\s─━—-]*$/.test(line) || /^[─━]*\s\S(?:.*\S)?\s[─━]$/.test(line)
}

export function isQueueBound(line: string): boolean {
  return /^\s*$/.test(line) || SPINNER_ROW.test(line) || TOOL_ROW.test(line)
}

/**
 * A row only the transcript paints, never a queued message: a tool's `⎿` row
 * (its result, its hint, a taken prompt's `⎿  [Image #1]`) at exactly the
 * two-space indent Claude gives it. (A tool's dot at column zero is already a
 * bound: see isQueueBound.) A queued message's own lines start after the
 * two-column "❯ " gutter, so one of them matches only if a line of it starts
 * with "⎿": typed so, copied from the glyph onward, or wrapped just before a
 * "⎿" in the middle of pasted text. A line pasted whole from the terminal
 * keeps its indent and sits deeper.
 *
 * When an older queued entry does hold such a line, it costs a lot: that
 * entry and every older one above it are left out, and every consumer takes
 * them for messages the agent took. They are drawn as sent while they still
 * wait, a peer row above them is counted as arrived, and the pencil's
 * whole-queue recall leaves them unsent in the desktop's input (review,
 * 2026-09-27). Accepted, because the transcript's `⎿` row is on screen every
 * time a tool runs under a prompt the agent took with a message queued, and
 * the other case needs a line pasted from the glyph onward.
 *
 * Not a tool group's count line ("Ran 6 shell commands", "Read 3 files"),
 * though a finished group draws it with no glyph: a person writes "Read 3
 * files in src first", and a prompt wraps before "Ran" as readily as before
 * any word. Tried and withdrawn in review (2026-09-27): it cut real older
 * entries, and every consumer then took them for messages the agent had taken.
 *
 * Why it is needed: Claude puts a blank row above the queue, but Orca 1.4.212
 * drops every blank row from `terminal.read --screen` (`Dxa` in its main
 * bundle), so nothing else separates the transcript's last rows from the
 * queue. And a running tool's dot blinks (`Bo` in 2.1.283: " " every other
 * 600 ms), so on the off frame its rows read as two spaces and words. The
 * scan walked up through them to the prompt the agent had taken and read it,
 * with the tool's rows, as a queued message; the chat drew it as a second
 * bubble (2026-09-27, fixtures/claude-running-tool-under-absorbed-prompt-2.1.283.ts).
 */
function isTranscriptToolRow(line: string): boolean {
  return /^ {2}⎿/.test(line)
}

/**
 * The rows of the queue block from Claude Code 2.1.277 on, by index: marked
 * rows at column zero and indented rows, from the first marked row down to the
 * send-now row at `sendNow`; and whether a row that cannot be a queued message
 * closes them above.
 *
 * Everything between the newest entry's marker and the send-now row is that
 * entry, whatever it holds. Above that marker the rows are older entries until
 * a row the transcript paints (isTranscriptToolRow) or a bound. What still
 * reads wrong, as before: straight under the prompt the agent took, a
 * finished group's count line ("Ran 6 shell commands"), or a running group's
 * first row with its dot blinked off and no `⎿` row under it. Each is two
 * spaces and words, like a line of the prompt, and on one screen nothing
 * tells them apart, so the prompt and that line read as an older entry.
 */
export function queueBlockRows(lines: readonly string[], sendNow: number): { rows: number[]; bounded: boolean } {
  const rows: number[] = []
  let bounded = false
  let pastNewest = false
  for (let index = sendNow - 1; index >= Math.max(0, sendNow - 60); index -= 1) {
    const line = lines[index]!
    if (pastNewest && isTranscriptToolRow(line)) {
      bounded = true
      break
    }
    if (/^[❯›>]\s+\S/.test(line) || /^\s{2,}\S/.test(line)) {
      rows.unshift(index)
      pastNewest ||= /^[❯›>]\s+\S/.test(line)
      continue
    }
    bounded = isQueueBound(line)
    if (!bounded) {
      // A spinner line that hard-wrapped on a phone-width terminal puts its
      // tail at column zero, marker-less. The row above it says what it is.
      const above = lines[index - 1]
      bounded = above !== undefined && SPINNER_ROW.test(above)
    }
    break
  }
  // Indented rows above the first marker are not a message's wrapped lines:
  // they belong to whatever sits above the queue (a tool row's own
  // continuation, the spinner's todo list).
  while (rows.length > 0 && !/^[❯›>]\s+\S/.test(lines[rows[0]!]!)) {
    rows.shift()
  }
  return { rows, bounded }
}

/** The screen with the composer's text back in it: Orca removes it from the
 *  tail and publishes it separately, even when Claude paints a queue hint as
 *  a placeholder in that composer. */
export function withComposerText(screen: readonly string[], draft: unknown): string[] {
  const lines = [...screen]
  if (typeof draft === 'string' && (QUEUE_HINT.test(draft) || SELECTED_HINT.test(draft))) {
    const input = lines.findLastIndex((line) => /^\s*❯\s*$/.test(line))
    if (input !== -1) {
      lines[input] = `❯ ${draft}`
    }
  }
  return lines
}

/** Three lines from `index`, joined: either footer can wrap on a narrow
 *  phone-sized terminal. */
export function footerWindow(lines: readonly string[], index: number): string {
  return lines
    .slice(index, index + 3)
    .map((part) => part.trim())
    .join(' ')
}

export function queueFooterIndex(lines: readonly string[]): number {
  return lines.findLastIndex(
    (line, index) =>
      (/^\s*[❯›>]?\s*Press up to\b/i.test(line) && QUEUE_HINT.test(footerWindow(lines, index))) ||
      (/^\s*[❯›>]?\s*Press Enter\b/i.test(line) && SELECTED_HINT.test(footerWindow(lines, index)))
  )
}

/**
 * The screen lines the agent's queue box takes up, by index: the rows the
 * queue reader reads as its entries, no more. Anything painted there is
 * waiting, not yet in the turn, and the peer-row reader leaves it out
 * (mobile-terminal-peer-notices.ts), so a peer message is first seen where
 * Claude paints it in the turn when it takes it: its row is anchored there,
 * and the status's copy of it, read as Claude takes it, can pair with it.
 * Sighted in the box it was anchored where it waited, and a minute later its
 * copy was too far off to pair.
 *
 * The block from 2.1.277 on is the marked rows over the send-now row, with
 * their wrapped lines; the older one is the indented block over its footer.
 * A peer message queued alone gets neither (Claude Code 2.1.283 draws them
 * only for a queued command a person could edit), and its row is read where
 * it waits; the count rule keeps it one message (screen-peer-notices.ts).
 */
export function queueBlockLineIndices(screen: readonly string[], draft?: unknown): ReadonlySet<number> {
  const lines = withComposerText(screen, draft)
  const block = new Set<number>()
  const sendNow = lines.findLastIndex((line) => SEND_NOW_HINT.test(line))
  if (sendNow !== -1) {
    // The rows columnZeroQueueEntries collects, by the same scan.
    return new Set(queueBlockRows(lines, sendNow).rows)
  }
  const footer = queueFooterIndex(lines)
  let seenEntry = false
  for (let index = footer - 1; footer !== -1 && index >= Math.max(0, footer - 60); index -= 1) {
    const line = lines[index]!
    if (isLegacyQueueSeparator(line)) {
      if (seenEntry) {
        break
      }
      continue
    }
    if (/^[❯›>]\s/.test(line) || (!/^\s+[❯›>]\s+\S/.test(line) && !/^\s{2,}\S/.test(line))) {
      break
    }
    seenEntry ||= /^\s+[❯›>]\s+\S/.test(line)
    block.add(index)
  }
  return block
}
