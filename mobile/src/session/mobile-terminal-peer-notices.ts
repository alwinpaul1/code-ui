import { queueBlockLineIndices } from './mobile-terminal-queue-block'

/**
 * Peer messages Claude Code has painted on its own screen.
 *
 * Why: a message from another session or a subagent reaches the transcript
 * mostly as records Orca's reader never publishes (of 58 on this machine, 35
 * were mid-turn `attachment` records and 20 `isMeta` rows; 3 reached the
 * phone). Claude does paint each landing as a row. Two forms, both from tmux
 * captures of Claude Code 2.1.278 at 46 columns (2026-09-20, fixtures beside
 * the test). 2.1.283 draws the row with 2.1.282's code, "(ctrl+o to expand)"
 * included; its new click-to-expand in fullscreen mode does not change the row
 * (binaries compared 2026-09-26):
 *
 * A subagent's message names the sender and nothing more (the message is
 * behind ctrl+o):
 *
 *     › Message from @probe (ctrl+o to expand)
 *
 * Another session's message carries the message inline, wrapped at column
 * 0, the tail itself free to wrap:
 *
 *     › Message from @code-ui-6f: Capture probe from
 *     the Code UI session: reply with the single
 *     word received and nothing else. (ctrl+o to
 *     expand)
 *
 * The name after `@` is the sender's session name — the transcript record's
 * `from-name` for the same message, checked in that session's JSONL — so
 * the transcript row, when it does arrive, is paired by it
 * (screen-peer-notices.ts). A `⏺ Teammate @x finished` row is the agent's
 * completion, carried elsewhere, and is not read.
 */

export type ScreenPeerRow = {
  sender: string
  /** The message as painted, when the row carried it; absent for the
   *  subagent form. */
  body?: string
  /** The last ABOVE_CHARACTERS characters painted above the row, with every
   *  space and line break taken out so a rewrap at another width reads the
   *  same. A subagent's row names only its sender, so this is what tells a
   *  second message from the same agent from the first once that one has
   *  scrolled off (screen-peer-notices.ts). Absent for a row too near the top
   *  of the screen to have that much above it. */
  above?: string
  /** The nearest line above the row with something on it, with its spaces
   *  and the TUI's own marks (the `⏺`, `⎿` gutter and box drawing) taken
   *  out: the end of what was painted just before the row, often a tool's
   *  output. Absent for a row with no such line above it on screen. */
  lastLine?: string
}

/** The TUI's own marks: a line's gutter glyphs and box drawing. */
const TUI_MARKS = /[\u2500-\u259F⏺⎿●✻✳✽✶✢·›❯]/g

function lastLineAbove(screen: readonly string[], row: number): string | undefined {
  for (let line = row - 1; line >= 0; line -= 1) {
    const text = (screen[line] ?? '').replaceAll(TUI_MARKS, '').replaceAll(/\s+/g, '')
    if (text.length > 0) {
      return text
    }
  }
  return undefined
}

/** Enough of what came before a row to tell it from another row of the same
 *  sender: at 46 columns, the last line or two above it. */
export const ABOVE_CHARACTERS = 48

function paintedAbove(screen: readonly string[], row: number): string | undefined {
  let text = ''
  for (let line = row - 1; line >= 0 && text.length < ABOVE_CHARACTERS; line -= 1) {
    text = (screen[line] ?? '').replaceAll(/\s+/g, '') + text
  }
  return text.length >= ABOVE_CHARACTERS ? text.slice(-ABOVE_CHARACTERS) : undefined
}

/** The marker Claude paints for these rows is `›` (U+203A), not the `❯` of a
 *  prompt; the sent-prompt reader skips them by wording for the same reason. */
const HEAD = /^› (?:Cross-session message|Message) from @(\S+?)(?::\s(.*)| (\(ctrl\+o to expand\))\s*)$/

/** Whether a screen line is the head of one of these rows, wherever it is
 *  painted: the agent's queue box paints a queued peer message the same way
 *  (mobile-terminal-queued-messages.ts). */
export function isPeerRowHead(line: string): boolean {
  return HEAD.test(line.replace(/^\s+/, ''))
}
/** A wrapped continuation row: at column 0, and not the start of anything
 *  else Claude paints there. */
const CONTINUATION = /^(?![\s⏺⎿❯›>✻✳✽✶✢·*])(\S.*)$/
const TAIL = /^(.*?)\s*\(ctrl\+o to expand\)\s*$/
/** A painted message is a preview; past this many rows it is something else. */
const MAX_ROWS = 12

/** Every peer-message row on screen, in order, one per row, less those in
 *  the agent's queue box: a message waiting there is not in the turn yet, and
 *  read there it was counted again once Claude took it and painted it in the
 *  turn (queueBlockLineIndices). `draft`: the composer's text, as the queue
 *  reader takes it. */
export function peerNoticesFromScreen(screen: readonly string[], draft?: unknown): ScreenPeerRow[] {
  const found: ScreenPeerRow[] = []
  const queued = queueBlockLineIndices(screen, draft)
  let index = 0
  while (index < screen.length) {
    if (queued.has(index)) {
      index += 1
      continue
    }
    const head = HEAD.exec(screen[index] ?? '')
    if (!head?.[1]) {
      index += 1
      continue
    }
    const sender = head[1]
    const above = paintedAbove(screen, index)
    const lastLine = lastLineAbove(screen, index)
    const context = { ...(above === undefined ? {} : { above }), ...(lastLine === undefined ? {} : { lastLine }) }
    if (head[3]) {
      found.push({ sender, ...context })
      index += 1
      continue
    }
    // The bodied form: gather column-0 rows until the tail closes it.
    let text = head[2] ?? ''
    let end = index
    let closed = TAIL.exec(text)
    while (!closed && end - index < MAX_ROWS) {
      const next = CONTINUATION.exec(screen[end + 1] ?? '')
      if (!next) {
        break
      }
      end += 1
      text = `${text} ${next[1] ?? ''}`
      closed = TAIL.exec(text)
    }
    if (closed) {
      const body = (closed[1] ?? '').replaceAll(/\s+/g, ' ').trim()
      found.push(body.length > 0 ? { sender, body, ...context } : { sender, ...context })
      index = end + 1
    } else {
      index += 1
    }
  }
  return found
}
