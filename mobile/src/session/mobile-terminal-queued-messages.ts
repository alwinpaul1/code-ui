import { normalizeNativeChatUserText } from './mobile-native-chat-image-transcript-markers'
import { asPaintedPrompt } from './mobile-terminal-prompt-paint'
import { splitOrcaPastedImagePaths } from '../../../src/shared/native-chat-pasted-image-paths'
/** Verified against Claude Code 2.1.263. Two different queue footers exist:
 * the legacy whole-queue recall, and the per-message selector that only appears
 * when CLAUDE_CODE_KB_COHESION_FIXES is set in the agent's environment.
 * Claude Code 2.1.277 keeps the placeholder but redraws the block itself —
 * see `columnZeroQueueEntries`. */
export const QUEUE_HINT =
  /^\s*[❯›>]?\s*Press up to (?:edit queued messages|select a queued message)\b/i
export const SELECTED_HINT = /^\s*[❯›>]?\s*Press Enter to edit the selected message\b/i

export type ClaudeQueueView = {
  /** Empty while an entry is selected: the rows are ambiguous then. */
  entries: string[]
  /** Claude offers its per-message selector on this build. */
  selectable: boolean
  /** One entry carries the marker right now. */
  selecting: boolean
  /** First rendered line of the marked entry, wrapped as Claude drew it. */
  selected: string | null
  /** The marker is on the oldest entry: Claude offers history above it. */
  selectedOldest: boolean
}

const EMPTY_VIEW: ClaudeQueueView = {
  entries: [],
  selectable: false,
  selecting: false,
  selected: null,
  selectedOldest: false
}

/** Read only the explicit Claude queue block immediately above its queue footer.
 * The screen can show only a subset of a long queue; never use this to rewrite it. */
export function claudeQueueViewFromScreen(
  screen: readonly string[],
  draft?: unknown
): ClaudeQueueView {
  const lines = [...screen]
  // Orca removes the composer text from tail and publishes it separately, even
  // when Claude paints a queue hint as a placeholder in that composer.
  if (typeof draft === 'string' && (QUEUE_HINT.test(draft) || SELECTED_HINT.test(draft))) {
    const input = lines.findLastIndex((line) => /^\s*❯\s*$/.test(line))
    if (input !== -1) {
      lines[input] = `❯ ${draft}`
    }
  }
  // Either footer can wrap on a narrow phone-sized terminal.
  const window = (index: number) =>
    lines
      .slice(index, index + 3)
      .map((part) => part.trim())
      .join(' ')
  const footer = lines.findLastIndex(
    (line, index) =>
      (/^\s*[❯›>]?\s*Press up to\b/i.test(line) && QUEUE_HINT.test(window(index))) ||
      (/^\s*[❯›>]?\s*Press Enter\b/i.test(line) && SELECTED_HINT.test(window(index)))
  )
  if (footer === -1) {
    return EMPTY_VIEW
  }
  const hint = window(footer)
  const selecting = SELECTED_HINT.test(hint)
  const selectable = selecting || /select a queued message/i.test(hint)
  if (!selecting) {
    const sendNow = sendNowHintAbove(lines, footer)
    if (sendNow !== -1) {
      return {
        entries: columnZeroQueueEntries(lines, sendNow).map(withoutComposerNotice),
        selectable,
        selecting: false,
        selected: null,
        selectedOldest: false
      }
    }
  }
  const block: string[] = []
  let seenEntry = false
  for (let i = footer - 1; i >= Math.max(0, footer - 60); i--) {
    const line = lines[i]!
    if (!seenEntry && /^\s{8,}Ctrl\+Y to paste deleted text\s*$/.test(line)) {
      continue
    }
    if (/^[\s─━—-]*$/.test(line)) {
      if (seenEntry) {
        break
      }
      continue
    }
    // Claude indents a queue row two spaces and draws a transcript message at
    // column zero with the same marker. A column-zero message's wrapped lines
    // are indented like a queue continuation, so a scan that accepts either
    // walks off the top of the queue and glues transcript text onto an entry.
    if (/^[❯›>]\s/.test(line)) {
      break
    }
    if (/^\s+[❯›>]\s+\S/.test(line)) {
      seenEntry = true
    } else if (!/^\s{2,}\S/.test(line)) {
      break
    }
    block.unshift(line)
  }
  // While an entry is selected Claude drops the marker from every other row,
  // leaving them at the same four-space indent as a wrapped continuation line.
  // The two are then indistinguishable, so refuse to split the block at all;
  // only the single marked row can still be read with confidence.
  if (selecting) {
    const marked = block.map((line) => /^\s+[❯›>]\s+(.+)$/.exec(line)?.[1]?.trim()).filter(Boolean)
    return {
      entries: [],
      selectable,
      selecting: true,
      selected: marked.length === 1 ? marked[0]! : null,
      selectedOldest: /up again for history/i.test(hint)
    }
  }
  const entries: string[] = []
  for (const line of block) {
    const match = /^\s+[❯›>]\s+(.+)$/.exec(line)
    if (match) {
      entries.push(match[1]!.trim())
    } else if (entries.length) {
      entries[entries.length - 1] += '\n' + line.trim()
    }
  }
  return {
    entries: entries.map(withoutComposerNotice),
    selectable,
    selecting: false,
    selected: null,
    selectedOldest: false
  }
}

/** Claude Code 2.1.277 closes its queue block with this row instead of putting
 *  "Enter to send them immediately" in the composer placeholder. Its presence
 *  is what tells the 2.1.277 shape from a 2.1.263 transcript echo, which draws
 *  a delivered message with the same column-zero marker. The chord differs by
 *  build: "ctrl+x ctrl+s to send now" on 2.1.277, "ctrl+enter to send now" on
 *  2.1.280 (2026-09-23), so any key chord before "to send now" closes it. */
const SEND_NOW_HINT = /^\s*(?:(?:ctrl|shift|alt|option|opt|cmd|meta)\+\S+\s+)+to send now\s*$/i
/** The working spinner Claude draws between the transcript and the queue:
 *  "✻ Frolicking… (15m 36s · ↓ 56.6k tokens)". The glyph rotates; the
 *  ellipsis after the verb does not. */
const SPINNER_ROW = /^[^\s❯›>⏺⎿]\s+\S.*…/
const TOOL_ROW = /^\s*[⏺⎿]/

function isQueueBound(line: string): boolean {
  return /^\s*$/.test(line) || SPINNER_ROW.test(line) || TOOL_ROW.test(line)
}

/** Index of the "… to send now" row directly above the composer,
 *  looking past the separator and Claude's right-aligned yank hint, or -1. */
/** A "⎿" row Claude hangs under its spinner ("✻ Incubating… (31m 27s · ↓ 67.8k
 *  tokens)"), such as a tip. */
const SPINNER_DETAIL_ROW = /^\s+⎿\s+\S/

/**
 * The send-now row that closes the queue, or -1.
 *
 * Claude Code 2.1.277 and 2.1.280 draw it right above the input box. 2.1.281
 * (2026-09-24) moved the queue above the spinner, so the spinner and its "⎿
 * Tip:" row stand between them; not skipping those read no queue, and the chat
 * drew a queued message as already sent. A "⎿" row is skipped only when a
 * spinner owns it: anything else there is not this layout, and is refused.
 */
function sendNowHintAbove(lines: readonly string[], footer: number): number {
  let details = 0
  for (let i = footer - 1; i >= Math.max(0, footer - 8); i--) {
    const line = lines[i]!
    if (/^[\s─━—-]*$/.test(line) || /^\s{8,}Ctrl\+Y to paste deleted text\s*$/.test(line)) {
      continue
    }
    if (SPINNER_DETAIL_ROW.test(line)) {
      details += 1
      continue
    }
    if (SPINNER_ROW.test(line)) {
      details = 0
      continue
    }
    return details === 0 && SEND_NOW_HINT.test(line) ? i : -1
  }
  return -1
}

/**
 * Claude Code 2.1.277 draws each queued message at column zero, marker first,
 * with its wrapped lines indented two spaces, between the spinner and the
 * send-now row (captured live 2026-09-19; see the test fixture). Read upward
 * from the hint. The block must end at a row that cannot be message text — the
 * spinner, a blank, a tool row — or the reading is refused: a delivered
 * message in the transcript has exactly this shape, and with nothing between
 * it and the queue the two cannot be told apart. A wrong queue rewrite loses
 * the user's messages; an empty one only hides a pencil.
 */
function columnZeroQueueEntries(lines: readonly string[], sendNow: number): string[] {
  const rows: string[] = []
  let bounded = false
  let i = sendNow - 1
  for (; i >= Math.max(0, sendNow - 60); i--) {
    const line = lines[i]!
    if (/^[❯›>]\s+\S/.test(line) || /^\s{2,}\S/.test(line)) {
      rows.unshift(line)
      continue
    }
    bounded = isQueueBound(line)
    if (!bounded) {
      // A spinner line that hard-wrapped on a phone-width terminal puts its
      // tail at column zero, marker-less. The row above it says what it is.
      const above = lines[i - 1]
      bounded = above !== undefined && SPINNER_ROW.test(above)
    }
    break
  }
  // Indented rows above the first marker are not a message's wrapped lines:
  // they belong to whatever sits above the queue (a tool row's own
  // continuation, the spinner's todo list).
  while (rows.length > 0 && !/^[❯›>]\s+\S/.test(rows[0]!)) {
    rows.shift()
  }
  if (!bounded || rows.length === 0) {
    return []
  }
  const entries: string[] = []
  for (const line of rows) {
    const match = /^[❯›>]\s+(.+)$/.exec(line)
    if (match) {
      entries.push(match[1]!.trim())
    } else {
      entries[entries.length - 1] += '\n' + line.trim()
    }
  }
  return entries
}

/** Claude's own context warning, drawn in the composer box beside the queue
 *  ("1% until auto-compact"). It is not part of anyone's message, but it sits
 *  inside the block this scan walks, so it was glued onto the last queued entry
 *  — the phone then drew it inside the user's own bubble AND, because the
 *  contaminated text no longer equalled the message the agent was told about,
 *  the echo never retired and the message stood three times over
 *  (2026-09-14, from the phone with a screenshot). */
const COMPOSER_NOTICE = /^\s*\d+%\s+until\s+auto-compact\s*$/i

export function withoutComposerNotice(entry: string): string {
  const lines = entry.split('\n')
  while (lines.length > 1 && COMPOSER_NOTICE.test(lines[lines.length - 1]!)) {
    lines.pop()
  }
  // A lone notice is not a message at all; keep it rather than return nothing,
  // so an entry is never silently emptied.
  return lines.join('\n')
}

export function queuedMessagesFromScreen(screen: readonly string[], draft?: unknown): string[] {
  return claudeQueueViewFromScreen(screen, draft).entries
}

/** Enough of a row to be sure it is the same message and not a shorter one
 *  that merely starts the same way. "ok" is a prefix of half the language. */
const QUEUE_ROW_MATCH_FLOOR = 24

/** Whether the row Claude drew in its queue box is this pending send.
 *
 *  Not equality: the box only ever holds what fits, so a long message is drawn
 *  shortened, sometimes with an ellipsis. Comparing exactly left the send
 *  standing as a bubble AND as a queue row at the same time (reported twice
 *  from the phone with screenshots, 2026-09-14). Compare the printing
 *  characters only — the drawn row's line breaks are Claude's wrapping, not the
 *  author's — and accept the drawn row as a prefix of what was sent once it is
 *  long enough to be unambiguous. */
export function queueRowIsPendingSend(sent: string, drawn: string): boolean {
  const dense = (text: string) => asPaintedPrompt(text).replace(/\s+/g, '')
  const want = dense(sent)
  const row = dense(drawn).replace(/(?:\u2026|\.{3})$/, '')
  if (row.length === 0 || want.length === 0) {
    return false
  }
  if (row === want) {
    return true
  }
  // One direction only. The drawn row is a SHORTENED form of what was sent, so
  // the send starts with the row — never the reverse. Accepting both let a
  // short pending claim a longer message's row: its own bubble vanished while
  // it was still queued, and the longer one showed twice (2026-09-14 review).
  return row.length >= QUEUE_ROW_MATCH_FLOOR && want.startsWith(row)
}

/** Whether a screen READING is nothing but landed rows the parser joined.
 *
 *  Messages typed while the agent is busy stack as plain rows and the scrollback
 *  parser joins them into one reading, so the reading can be LONGER than any one
 *  transcript row. A prefix test cannot be used to spot that: a genuinely
 *  different, longer message extends a landed row exactly the same way, and
 *  retiring on that loses a message with no row of its own — the loss `isCutOf`
 *  was written to prevent (2026-09-14 review).
 *
 *  So require the whole reading to be accounted for: it must be a run of landed
 *  rows, in order, with nothing left over. Then every part of it is already on
 *  screen as a real row and the held copy is redundant by construction.
 */
export function readingIsJoinedLandedRows(
  landed: readonly string[],
  reading: string
): boolean {
  const dense = (text: string) => asPaintedPrompt(text).replace(/\s+/g, '')
  const want = dense(reading)
  if (want.length < QUEUE_ROW_MATCH_FLOOR) {
    return false
  }
  const rows = landed.map(dense).filter((row) => row.length > 0)
  for (let start = 0; start < rows.length; start += 1) {
    let at = 0
    for (let index = start; index < rows.length; index += 1) {
      const row = rows[index]!
      if (!want.startsWith(row, at)) {
        break
      }
      at += row.length
      if (at === want.length && index > start) {
        // `index > start`: a single row is the plain equality case, which the
        // caller already covers; this branch exists only for a joined reading.
        return true
      }
    }
  }
  return false
}

export function pendingOutsideVisibleQueue<T extends { text: string }>(
  pending: readonly T[],
  queue: readonly string[]
): T[] {
  const remaining = [...queue]
  return pending.filter((item) => {
    // Longest match wins. With two pendings where one starts the other, taking
    // the first match let the shorter one consume the longer one's row.
    let best = -1
    let bestLength = -1
    for (const [index, row] of remaining.entries()) {
      if (row !== null && queueRowIsPendingSend(item.text, row) && row.length > bestLength) {
        best = index
        bestLength = row.length
      }
    }
    if (best === -1) {
      return true
    }
    remaining.splice(best, 1)
    return false
  })
}

/** A row that is the phone's own send shows the text the phone SENT, not the
 *  row Claude drew: a photo row's drawn text carries the paste marker or the
 *  temp-file path, and any row is wrapped where the agent's screen wrapped it
 *  ("…confirm with jev and / then fixx / and again…", device 2026-09-20).
 *  `caption` keeps the drawn row, because that is what a recall has to match
 *  against. A row with no own send behind it — typed on the desk — stays a
 *  string, the screen's own reading. */
export type MobileChatQueueEntry = string | { text: string; images: string[]; caption: string }

/** Show each confirmed queued send once, as typed, retaining local photos. */
export function projectMobileChatQueue<T extends { text: string; images?: string[] }>(
  pending: readonly T[],
  queue: readonly string[]
): { pending: T[]; queue: MobileChatQueueEntry[] } {
  const available = pending.filter((item) => item.images?.length)
  const matched = new Set<T>()
  const projected = queue.map((text): MobileChatQueueEntry => {
    if (!splitOrcaPastedImagePaths(text).paths.length && !/\[Image #\d+\]/.test(text)) {
      return text
    }
    const normalized = normalizeNativeChatUserText(asPaintedPrompt(text))
    const index = available.findIndex(
      (item) => normalizeNativeChatUserText(asPaintedPrompt(item.text)) === normalized
    )
    if (index === -1) {
      return text
    }
    const item = available.splice(index, 1)[0]!
    matched.add(item)
    return { text: item.text, images: item.images!, caption: text }
  })
  // Plain rows: the longest own send a row is (queueRowIsPendingSend) takes
  // the row's place, as typed; the same rule pendingOutsideVisibleQueue hides
  // the pending bubble by, so the two never disagree about which row is whose.
  const remaining = pending.filter((item) => !matched.has(item))
  for (let index = 0; index < projected.length; index += 1) {
    const row = projected[index]
    if (typeof row !== 'string') {
      continue
    }
    let best: T | null = null
    for (const item of remaining) {
      if (!matched.has(item) && queueRowIsPendingSend(item.text, row) && (best === null || item.text.length > best.text.length)) {
        best = item
      }
    }
    if (best !== null) {
      matched.add(best)
      projected[index] = { text: best.text, images: best.images ?? [], caption: row }
    }
  }
  return {
    pending: pending.filter((item) => !matched.has(item)),
    queue: projected
  }
}
