import { stripImagePromptMarker } from '../../../src/shared/native-chat-image-transcript-markers'

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

/** An accepted prompt: the marker at column 0 and a PLAIN space after it. */
const PROMPT_ROW = /^[>❯›] (\S.*)$/
/** The live composer: the marker followed by a no-break space, or nothing. */
const COMPOSER_ROW = /^[>❯›](?:\u00a0.*|\s*)$/
/** A wrapped continuation of the prompt: exactly two spaces, then text that
 *  is not one of the glyphs the agent uses for its own rows. */
const CONTINUATION = /^ {2}([^\s⎿└⌊⏺✻✓✗⏸│├╰╭◐◑◒◓].*)$/
/** Slash commands and `!` shell lines are typed into the same row, but they
 *  are not messages, and their output lands right under them. */
const LOCAL_COMMAND = /^[/!]/

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
    const parts = [head[1] ?? '']
    let cursor = index + 1
    while (cursor < limit) {
      const more = CONTINUATION.exec(screen[cursor] ?? '')
      if (!more) {
        break
      }
      parts.push(more[1] ?? '')
      cursor += 1
    }
    const text = stripImagePromptMarker(parts.join(' ')).trim()
    if (text.length > 0 && !LOCAL_COMMAND.test(text)) {
      prompts.push(text)
    }
    index = cursor
  }
  return prompts
}

/** Nothing below the composer is scrollback. Found by its own shape rather than
 *  a fixed tail, because the status area under it is as tall as the user's
 *  status line makes it. */
function composerIndex(screen: readonly string[]): number {
  for (let index = screen.length - 1; index >= 0; index -= 1) {
    if (COMPOSER_ROW.test(screen[index] ?? '')) {
      return index
    }
  }
  return screen.length
}
