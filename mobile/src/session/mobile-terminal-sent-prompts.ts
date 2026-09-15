
/**
 * Prompts Claude has already accepted, read off its own screen.
 *
 * Why this exists: a prompt submitted while a turn is running is written to the
 * transcript as an `attachment`/`queued_command` record, and Orca's reader has
 * no code for that type at all, so the phone never receives it (verified
 * against the desktop bundle, 2026-09-13). The agent's queue is one witness,
 * but a prompt taken between two tool calls can be absorbed before the phone's
 * one-second screen poll ever sees the queue box. Once absorbed, Claude prints
 * the prompt into its scrollback as a `❯` row, and that row stays on screen for
 * a while — long enough to be read.
 *
 * This is a mirror, never a source of truth: the rows are wrapped to the
 * terminal's width, so the text can come back re-wrapped. It is only ever used
 * for prompts the transcript does not carry, and it is dropped the moment the
 * transcript does.
 *
 * The shape, captured with `tmux capture-pane -p` from Claude Code 2.1.270
 * (2026-09-13):
 *
 *     ❯ run echo one and then echo two, then reply with the single word done
 *       second prompt that is long enough to wrap around the terminal width
 *       sure yes
 *
 *       Ran 1 shell command
 *
 *     ⏺ done
 *
 * The prompt is one `❯ ` row (a plain space) plus continuation rows indented
 * exactly two spaces, ended by the first blank row. Everything the agent adds
 * underneath is also indented two spaces — `⎿  [Image #1]` attachment rows,
 * `⎿  Loaded …` hook output, the `Ran 1 shell command` fold, tool rows with a
 * ticking `· 6s` timer — and the first version of this parser read all of it
 * as more prompt text, so every poll produced a different "prompt" and a new
 * bubble (2026-09-13). The composer row is `❯` followed by a NO-BREAK space,
 * which is how it is told apart from an accepted prompt; Orca also strips the
 * draft out of it, leaving a bare `❯`.
 */

/** An accepted prompt: the marker at column 0 and a PLAIN space after it.
 *  `>` is deliberately NOT a prompt marker, though it is accepted for the
 *  composer below: a markdown blockquote in the agent's own answer reaches
 *  column 0 as `> quoted line` and was read as a message the user had sent
 *  (2026-09-13). Claude Code 2.1.270 paints `❯`; a build that paints `>`
 *  loses this witness rather than inventing messages from the agent's prose. */
const PROMPT_ROW = /^[❯›] (\S.*)$/
/** The live composer: the marker followed by a no-break space, or nothing. */
const COMPOSER_ROW = /^[>❯›](?:\u00a0.*|\s*)$/
/** A wrapped continuation of the prompt: exactly two spaces, then text that
 *  is not one of the glyphs the agent uses for its own rows.
 *
 *  `\u2500-\u259f` is the box-drawing block and the block elements after it,
 *  refused ENTIRE rather than a glyph at a time. The list used to name │ ├ ╰ ╭
 *  └ individually, each added after it was reported, and a framed panel printed
 *  under a prompt then arrived as a bubble reading "push ┌────┬────┐" because
 *  ┌ and ─ were not among them (2026-09-15). Nothing in that block starts a
 *  line a person typed; a hyphen and an em dash are outside it and still do. */
const CONTINUATION = /^ {2}([^\s\u2500-\u259f⎿⌊⏺✻✓✗⏸◐◑◒◓].*)$/
/** A picker's chosen row: a radio glyph, the value, and the command that set it
 *  — `◉ xhigh · /effort`. Matched by SHAPE, not by the glyph alone: excluding
 *  the glyph outright ended the prompt at any bullet the user wrote, and the
 *  rest of their message went with it (2026-09-14 review). */
const PICKER_ROW = /^[◉◎○●◦]\s+\S.*\s·\s\/[\w-]+\s*$/
/** Slash commands and `!` shell lines are typed into the same row, but they
 *  are not messages, and their output lands right under them. */
const LOCAL_COMMAND = /^[/!]/
/** Rows Claude Code paints in the prompt's own shape that the user never
 *  typed: an incoming teammate message ("Message from @name (ctrl+o to
 *  expand)") read as a sent prompt on 2026-09-13. */
const HARNESS_NOTICE = /^(?:Message|Cross-session message|Idle notice) from @?\S+/
/** The prompt's OWN attachment row: `⎿  [Image #3]`, listing a picture the
 *  message carried. Claude prints these directly under the prompt, in the same
 *  shape a tool's output row uses. */
const ATTACHMENT_ROW = /^\s*⎿\s*\[Image #\d+\]\s*$/
/** What Claude paints after the blank row under a prompt once the turn's
 *  tools fold: "Ran 6 shell commands", "Read 2 files", "Edited a file". A
 *  prompt's own second paragraph sits on an identical two-space row, so this
 *  is the one place the parser has to judge by wording (2.1.270). */
/** The terminal's own truncation mark on a row it could not fit. */
function endsCut(text: string): boolean {
  return /[\u2026]\s*$/.test(text)
}

const FOLD_SUMMARY =
  /^(?:Ran|Read|Edited|Wrote|Searched|Listed|Fetched|Updated|Called|Used|Created|Deleted) (?:\d+|a|an|one) [a-z]+[a-z0-9 ,()]*$/

export function sentPromptsFromScreen(screen: readonly string[]): string[] {
  const prompts: string[] = []
  const limit = composerIndex(screen)
  let index = 0
  while (index < limit) {
    const head = PROMPT_ROW.exec(screen[index] ?? '')
    if (!head) {
      index += 1
      continue
    }
    // A row the screen CUT is not the message, it is a PREFIX of it: the
    // terminal replaced the rest with an ellipsis. Two things follow, and the
    // first attempt at this got both wrong (2026-09-15, live pr-919 session).
    //
    // It must not be offered as a prompt. A prefix can never equal the
    // transcript row it belongs to, so the echo it makes can never retire — it
    // sat on the phone as a bubble reading "…utilise the entire spac…", pinned
    // above the NEXT prompt with the agent's whole reply missing between them.
    // Refusing is the rule here: a truncated reading is a guess.
    //
    // And the scan has to carry on past it. Jumping to the composer dropped
    // every later prompt on the screen with it. The rows under a cut prompt are
    // the agent's reply on the same two-space indent, which no `❯` matches, so
    // resuming on the next row skips them harmlessly.
    if (endsCut(head[1] ?? '')) {
      index += 1
      continue
    }
    const parts = [head[1] ?? '']
    let cursor = index + 1
    while (cursor < limit) {
      const line = screen[cursor] ?? ''
      if (line.trim().length === 0) {
        // One blank row, then another two-space row, is a paragraph break
        // inside the prompt — unless that row is the tool fold.
        const next = CONTINUATION.exec(screen[cursor + 1] ?? '')
        if (
          cursor + 1 >= limit ||
          !next ||
          isFoldSummary(next[1] ?? '', screen, cursor + 1) ||
          isToolRow(next[1] ?? '', screen, cursor + 1)
        ) {
          break
        }
        parts.push('', next[1] ?? '')
        cursor += 2
        continue
      }
      const more = CONTINUATION.exec(line)
      // A prompt absorbed mid-turn gets its fold painted straight under it,
      // with no blank row between: "…verify on my phone Ran 7 shell commands"
      // was one bubble on the phone (2026-09-13, Claude Code 2.1.270).
      if (!more || isFoldSummary(more[1] ?? '', screen, cursor) || isToolRow(more[1] ?? '', screen, cursor)) {
        break
      }
      // Anything typed while the agent is busy stacks here as a plain two-space
      // row — same shape as a wrap (captured at 100 columns, 2026-09-14). A
      // slash command is never part of the prompt above it, and once one has
      // appeared every row after it is its own entry, not this prompt's tail.
      // A picker row is the agent's own chrome sitting inside the block, so drop
      // just that row and keep reading: ending the block here threw away
      // everything after it, which is what the glyph exclusion did wrong.
      if (PICKER_ROW.test(more[1] ?? '')) {
        cursor += 1
        continue
      }
      if (LOCAL_COMMAND.test(more[1] ?? '')) {
        break
      }
      parts.push(more[1] ?? '')
      cursor += 1
    }
    // The RAW text, markers and all. Deleting `[Image #N]` here left the phone
    // with no sign that anything had been attached — not the picture, which it
    // has no bytes for, and not the "Image on Desktop" placeholder either, which
    // is applied where the bubble is DRAWN and so needs the marker to still be
    // present (host screenshot, 2026-09-15). A prompt that was only an image
    // came through as the empty string and was dropped outright.
    //
    // Matching is unaffected: `normalizeNativeChatUserText` removes the markers
    // from both sides when an echo is reconciled against its transcript row, so
    // the keys agree either way. The desktop-beacon path already keeps them for
    // exactly this reason.
    const text = joinWrappedRows(parts).trim()
    if (text.length > 0 && !LOCAL_COMMAND.test(text) && !HARNESS_NOTICE.test(text)) {
      prompts.push(text)
    }
    index = cursor
  }
  return prompts
}

/** Nothing below the composer is scrollback. Found by its own shape rather than
 *  a fixed tail, because the status area under it is as tall as the user's
 *  status line makes it. No composer on screen (a permission dialog, a
 *  different agent, a build that paints it differently) means nothing can be
 *  told apart from a live draft, so nothing is read. */
function composerIndex(screen: readonly string[]): number {
  for (let index = screen.length - 1; index >= 0; index -= 1) {
    if (COMPOSER_ROW.test(screen[index] ?? '')) {
      return index
    }
  }
  return 0
}

/** The tool fold, not a second paragraph of the prompt. Both are two-space
 *  rows after a blank, so two things must hold: the row reads exactly like a
 *  summary (no punctuation a sentence would carry), and it ENDS its block —
 *  a paragraph runs on into more prose. Guessing on the wording alone ate a
 *  real paragraph that opened "Created a branch called …" (2026-09-13). */
function isFoldSummary(text: string, screen: readonly string[], index: number): boolean {
  if (!FOLD_SUMMARY.test(text)) {
    return false
  }
  const after = screen[index + 1] ?? ''
  return after.trim().length === 0 || !CONTINUATION.test(after)
}

/** The running tool, painted under the prompt while it works: a plain
 *  two-space row such as "Running Python sleep for 45 seconds · 18s" with
 *  the `⎿  $ command` row beneath it (captured 2026-09-13, 2.1.270). Its
 *  timer changes every second, so read as a paragraph it made a new bubble
 *  per poll — "…dude Running 1 shell command…", "…dude Capturing the phone
 *  screen right now". Told apart by the timer, by "Running", or by the `⎿`
 *  row that follows it; a paragraph of the prompt has none of those. */
function isToolRow(text: string, screen: readonly string[], index: number): boolean {
  // "Running 1 shell command…", "Reading 1 file…", "Capturing the phone
  // screen right now · 3s": a live tool row is a gerund with an ellipsis or
  // a timer. A paragraph the user typed is neither.
  if (/ · \d+s\b/.test(text) || /^[A-Z][a-z]+ing\b.*…$/.test(text)) {
    return true
  }
  // A following `⎿` row is evidence of a tool only when it carries OUTPUT. The
  // attachment rows under a prompt look identical and carry `[Image #N]`, and
  // Claude prints them directly beneath the prompt — so the last paragraph of
  // any prompt that included an image was read as a tool row and dropped, with
  // the paragraph going with it (host screenshot, 2026-09-15: "also have a
  // search bar for this" never reached the phone).
  const next = screen[index + 1] ?? ''
  return /^\s*⎿/.test(next) && !ATTACHMENT_ROW.test(next)
}

/** Rejoin what the terminal wrapped: a blank row is a real paragraph break,
 *  every other row continues the sentence above it. */
function joinWrappedRows(parts: readonly string[]): string {
  let out = ''
  for (const part of parts) {
    if (part === '') {
      out += '\n\n'
      continue
    }
    out += out.length === 0 || out.endsWith('\n') ? part : ` ${part}`
  }
  return out
}
