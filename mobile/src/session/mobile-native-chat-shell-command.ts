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
