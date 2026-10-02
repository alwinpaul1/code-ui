import { readClaudeInput } from './claude-composer-screen'
import { terminalScreenLinesRead } from './mobile-terminal-ask-about-screen-operations'

/** What a send says when the tab's terminal changed under it and the new one
 *  could not be shown to hold the agent's composer. Nothing was written. */
export const SEND_TERMINAL_RESTARTED = 'The terminal restarted; your message is kept. Send again.'

/** The terminal a composer send was verified against, and the tab it belongs to,
 *  handed to the message send so its own wait follows the TAB, not the handle.
 *  `reminted` is set by the message send when the tab got another terminal
 *  before it wrote a byte; the image hook then follows or refuses. */
export type MobileNativeChatSendFollow = {
  readonly terminal: string
  readonly tabChanged: () => boolean
  reminted: boolean
}

/** A shell prompt: a row ending in `$` or `#` (`~$ `), or in `%` after a space (zsh's
 *  `% `, where a percentage in a status row has a digit before it), or starting with
 *  a prompt glyph. What a plain shell draws under the box an exited Claude left. */
const SHELL_PROMPT = /[$#]\s*$|\s%\s*$|^\s*[➜❯λ]/u
const RULE_ROW = /^[\s─━]*[─━]{3}[\s─━]*$/

/**
 * Whether the screen shows Claude Code's own input box as the last thing drawn:
 * the `❯` row between its two rules (readClaudeInput) with no shell prompt under
 * the bottom rule. Claude does not use the alternate screen, so a shell that
 * took over after it exited can sit under the box it left; a located box alone
 * would call that screen Claude's. The status rows Claude draws under its box
 * (2.1.287: the HUD row, the mode row) end in neither `$`, `#` nor a spaced `%`.
 * `located: false` (a dialog, a `!` bash-mode box, a cut screen, a shell) is not
 * evidence: this answers false for it.
 */
export function claudeComposerIsLastOnScreen(lines: readonly string[]): boolean {
  if (!readClaudeInput(lines, '').located) {
    return false
  }
  const bottom = lines.findLastIndex((row) => RULE_ROW.test(row))
  return !lines.slice(bottom + 1).some((row) => SHELL_PROMPT.test(row))
}

/** The screen read the verification takes; the look's own. */
const SCREEN_READ_MS = 2_000

/**
 * Positive evidence that `terminal`'s screen is the agent's composer, read
 * fresh. Only Claude has a reader that tells its composer from everything else
 * on screen. Codex draws its input with `›`, and so does a sent prompt, a
 * popup's selected row and an approval's selected option
 * (codex-terminal-queued-messages.ts), so no screen proves Codex's composer is
 * up: Codex, any other agent and a read that fails or times out are all false.
 * The caller then refuses and keeps the draft.
 */
export async function agentComposerOnScreen(args: {
  client: Parameters<typeof terminalScreenLinesRead.request>[0]
  terminal: string
  agent?: string | null
  deadline?: number
}): Promise<boolean> {
  if (args.agent !== 'claude') {
    return false
  }
  try {
    const lines = terminalScreenLinesRead.interpret(
      await terminalScreenLinesRead.request(
        args.client,
        { terminal: args.terminal, screen: true },
        {
          timeoutMs: Math.max(
            1,
            Math.min(SCREEN_READ_MS, (args.deadline ?? Infinity) - Date.now())
          ),
          budgetSpansConnect: true
        }
      )
    )
    return lines !== null && claudeComposerIsLastOnScreen(lines)
  } catch {
    return false
  }
}
