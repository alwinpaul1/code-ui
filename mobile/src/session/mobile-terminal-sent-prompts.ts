
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
/** Slash commands and `!` shell lines are typed into the same row, but they
 *  are not messages, and their output lands right under them. */
const LOCAL_COMMAND = /^[/!]/
/** Rows Claude Code paints in the prompt's own shape that the user never
 *  typed: an incoming teammate message ("Message from @name (ctrl+o to
 *  expand)") read as a sent prompt on 2026-09-13. */
const HARNESS_NOTICE = /^(?:Message|Cross-session message|Idle notice) from @?\S+/
/** What Claude paints after the blank row under a prompt once the turn's
 *  tools fold: "Ran 6 shell commands", "Read 2 files", "Edited a file". A
 *  prompt's own second paragraph sits on an identical two-space row, so this
 *  is the one place the parser has to judge by wording (2.1.270). */
/** The terminal's own truncation mark on a row it could not fit. */
function endsCut(text: string): boolean {
  return /[\u2026]\s*$/.test(text)
}

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
    // The `❯` ROW AND NOTHING ELSE.
    //
    // The rows under a prompt used to be gathered as its wrapped continuation.
    // They are shaped exactly like the agent's own prose — two spaces, then
    // words — and nothing visible tells the two apart. So replies were glued
    // into messages (a bubble ending in the agent's own "session:ok", reported
    // as a leak), the paragraph under a prompt's image rows was lost, and a
    // framed panel arrived as "push ┌────┬────┐". Each was patched in turn; the
    // guessing was the defect, and this is the refusal the project's own rule
    // asks for when a screen is ambiguous.
    //
    // A long prompt therefore comes back as its first row, which is a PREFIX of
    // the real message. Retirement handles a prefix, so the transcript row
    // supersedes it when it lands.
    const text = (head[1] ?? '').trim()
    if (text.length > 0 && !LOCAL_COMMAND.test(text) && !HARNESS_NOTICE.test(text)) {
      prompts.push(text)
    }
    index += 1
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



