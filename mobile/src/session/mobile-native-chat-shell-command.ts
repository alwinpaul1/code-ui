/**
 * The agents whose input turns a message that STARTS with `!` into a shell
 * command run on the desktop. Claude Code 2.1.287: `Yy(text)` is 'bash' for a
 * leading "!", and a leading "!" arriving into the empty input switches it to
 * bash mode and strips it, as one key, one chunk or a paste (the phone empties
 * the input, then types the body as one write). Enter then runs the rest, with
 * no permission prompt. Codex 0.153.4: `Op::RunUserShellCommand`,
 * `core/src/tasks/user_shell.rs` and "! for shell commands" in its shortcuts
 * overlay (binary strings only, not run). Both read from the binaries; neither
 * was typed live.
 */
const SHELL_COMMAND_AGENTS: ReadonlySet<string> = new Set(['claude', 'codex'])

/**
 * What the message would run as a shell command, or null when it would not.
 *
 * "Starts with `!`" is taken on the text as typed, not trimmed: the send trims
 * the END only (`draftText.trimEnd()`), so a leading space or newline reaches
 * the agent and is no switch. An empty string means a bare `!`, which enters
 * bash mode and runs nothing (and strands the desktop in it).
 */
export function shellCommandOfSend(
  text: string,
  agent: string | null | undefined
): string | null {
  if (!agent || !SHELL_COMMAND_AGENTS.has(agent) || !text.startsWith('!')) {
    return null
  }
  return text.slice(1).trim()
}

/** Said when a message that starts with `!` carries a picture or a file, and nothing was sent.
 *  The terminal send pastes attachments BEFORE the words, so the `!` would land in a box that is
 *  no longer empty and go to the model as an ordinary prompt ("[Image #100]! node …",
 *  2026-10-16): Claude Code's bash mode takes text only. Refused rather than split into the
 *  command and then the picture: a split is two sends, and the second failing (or the first
 *  landing in Claude's queue behind the second) leaves the picture apart from the words it was
 *  attached to, or the command run with nobody asked about what came after it. A refusal sends
 *  nothing, keeps the words, the chips and the draft exactly where they are, and loses nothing. A
 *  leading space is no switch (shellCommandOfSend), so it is the way to send the words as a
 *  message. */
export const SHELL_COMMAND_ATTACHMENTS_REFUSAL =
  "Shell commands can't carry attachments, so nothing was sent. Remove the picture or file to run the command, or send it separately. To send this as an ordinary message, start it with a space."

/** Said where text is typed into the agent's input with no room to ask first (the
 *  queue editor): nothing was written. */
export const SHELL_COMMAND_QUEUE_REFUSAL =
  'A message that starts with ! runs as a shell command, so it cannot be put back in the queue. Send it from the chat box, where you are asked first.'

/** Said when a confirmed `!` message was typed and nothing on the screen or in the
 *  transcript showed the command ran. It may have: a retry would run it twice, so the
 *  word is about the shell and invites no retry. */
export const SHELL_COMMAND_UNCONFIRMED =
  "Sent to the desktop's shell; check the terminal before running it again."

/** What a chat send says when nothing showed it landed: the usual word, or the shell's. */
export const unconfirmedChatSendNotice = (text: string, agent: string | null | undefined): string =>
  shellCommandOfSend(text, agent) === null
    ? 'Delivery unconfirmed — check chat before retrying'
    : SHELL_COMMAND_UNCONFIRMED

/** Said when a rebuilt queue holds a `!` message the user did not just type: Claude Code
 *  2.1.287 can queue a shell command, and retyping it would run it again. The messages
 *  were recalled into the input (marked residue, which the next phone send clears) and
 *  nothing was written. */
export const SHELL_COMMAND_QUEUE_REBUILD_REFUSAL =
  'A queued message starts with ! and would run as a shell command again if it were retyped, so the queue was not rebuilt. Your messages are in the desktop input, unsent; the next message you send from the phone clears that input, so copy them first.'
