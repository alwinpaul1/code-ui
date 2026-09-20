/**
 * Peer messages Claude Code has painted on its own screen.
 *
 * Why: a message from another session or a subagent reaches the transcript
 * mostly as records Orca's reader never publishes (of 58 on this machine, 35
 * were mid-turn `attachment` records and 20 `isMeta` rows; 3 reached the
 * phone). Claude does paint each landing as a row. Two forms, both from tmux
 * captures of Claude Code 2.1.278 at 46 columns (2026-09-20, fixtures beside
 * the test):
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
}

/** The marker Claude paints for these rows is `›` (U+203A), not the `❯` of a
 *  prompt; the sent-prompt reader skips them by wording for the same reason. */
const HEAD = /^› (?:Cross-session message|Message) from @(\S+?)(?::\s(.*)| (\(ctrl\+o to expand\))\s*)$/
/** A wrapped continuation row: at column 0, and not the start of anything
 *  else Claude paints there. */
const CONTINUATION = /^(?![\s⏺⎿❯›>✻✳✽✶✢·*])(\S.*)$/
const TAIL = /^(.*?)\s*\(ctrl\+o to expand\)\s*$/
/** A painted message is a preview; past this many rows it is something else. */
const MAX_ROWS = 12

/** Every peer-message row on screen, in order, one per row. */
export function peerNoticesFromScreen(screen: readonly string[]): ScreenPeerRow[] {
  const found: ScreenPeerRow[] = []
  let index = 0
  while (index < screen.length) {
    const head = HEAD.exec(screen[index] ?? '')
    if (!head?.[1]) {
      index += 1
      continue
    }
    const sender = head[1]
    if (head[3]) {
      found.push({ sender })
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
      found.push(body.length > 0 ? { sender, body } : { sender })
      index = end + 1
    } else {
      index += 1
    }
  }
  return found
}
