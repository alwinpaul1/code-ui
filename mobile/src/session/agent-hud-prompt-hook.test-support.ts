/**
 * The body the prompt hook writes after `up=<pid>:` for a prompt it did not
 * cut: the prompt as Claude Code's hook JSON carries it (a JSON string body,
 * so a newline is `\n` and a quote `\"`), then the hook's `q` (ENCODE_FN,
 * agent-hud-tty-write.ts): `%` as `%25`, space as `%20`, `;` as `%3B`, and
 * nothing else. agent-hud-prompt-hook.test.ts checks it against the hook's
 * own output.
 *
 * Fixtures built the body with encodeURIComponent until 2026-09-30, which
 * the hook never writes; they read back right only because the reader
 * decoded the body a second time, which turned a `%41` the person typed
 * into `A` (agent-hud-beacon-desktop-prompt.ts).
 */
export function promptHookBody(text: string): string {
  return JSON.stringify(text).slice(1, -1).replace(/%/g, '%25').replace(/ /g, '%20').replace(/;/g, '%3B')
}
