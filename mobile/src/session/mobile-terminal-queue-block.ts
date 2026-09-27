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
const TOOL_ROW = /^\s*[⏺⎿]/

export function isQueueBound(line: string): boolean {
  return /^\s*$/.test(line) || SPINNER_ROW.test(line) || TOOL_ROW.test(line)
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
 * The screen lines the agent's queue box takes up, by index, whether or not
 * its entries can be read. Anything painted there is waiting, not yet in the
 * turn: a peer message's row in the box read as a message the turn had taken,
 * and once Claude took it and painted it in the turn it read as a second one
 * (combined review of fix/prompt-leak, 2026-09-27).
 *
 * The block from 2.1.277 on runs from the send-now row up to the first line
 * that cannot be a queued message's (a blank line, the spinner, a tool row);
 * the older one is the indented block over its footer.
 */
export function queueBlockLineIndices(screen: readonly string[], draft?: unknown): ReadonlySet<number> {
  const lines = withComposerText(screen, draft)
  const block = new Set<number>()
  const sendNow = lines.findLastIndex((line) => SEND_NOW_HINT.test(line))
  if (sendNow !== -1) {
    for (let index = sendNow - 1; index >= Math.max(0, sendNow - 60) && !isQueueBound(lines[index]!); index -= 1) {
      block.add(index)
    }
    return block
  }
  const footer = queueFooterIndex(lines)
  let seenEntry = false
  for (let index = footer - 1; footer !== -1 && index >= Math.max(0, footer - 60); index -= 1) {
    const line = lines[index]!
    if (/^[\s─━—-]*$/.test(line)) {
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
