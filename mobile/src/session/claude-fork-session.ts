import type { RpcClient } from '../transport/rpc-client'
import { buildTerminalSendParams } from '../terminal/terminal-send-request'
import { forkSessionWrite } from './claude-fork-session-operations'

/**
 * Claude Code's typed `/fork` command. The CLI resumes the session as a new
 * branch itself (its own `--fork-session` machinery, per
 * agent-session-journal-item-key.ts) — the phone only ever types the command
 * and submits it, the same as a person would in the terminal.
 *
 * mobile-chat-command-overlay.ts lists `/fork` in CLAUDE_TRANSCRIPT_COMMANDS:
 * it acts and answers in the transcript (Claude Code 2.1.267), so typing it
 * and pressing Enter is a complete, self-contained action — no overlay
 * follows, unlike `/model` or `/resume`.
 */
export const CLAUDE_FORK_COMMAND_TEXT = '/fork'

/**
 * Whether the Fork action should be offered at all.
 *
 * `/fork` typed while a turn is running lands behind it in the queue instead
 * of running now, so the button only appears once the pane is fully idle
 * (`done`) — not mid-turn, and not while a permission or question prompt
 * (`blocked`, `waiting`) has the screen, where typed text would be read as an
 * answer to that prompt rather than a command. Codex has no `/fork`, so the
 * button never appears there.
 */
export function canForkClaudeSession(state: {
  agent: string | null
  status: string | null
}): boolean {
  return state.agent === 'claude' && state.status === 'done'
}

/** Type `/fork` and submit it. True when the host accepted the write. Never
 *  throws: this runs from a tap handler, where a rejection has nowhere to go. */
export async function forkClaudeSession(args: {
  client: RpcClient
  terminal: string
  deviceToken: string | null
}): Promise<boolean> {
  try {
    if (args.client.getState() !== 'connected') {
      return false
    }
    const accepted = forkSessionWrite.interpret(
      await forkSessionWrite.request(
        args.client,
        buildTerminalSendParams({
          terminal: args.terminal,
          text: CLAUDE_FORK_COMMAND_TEXT,
          // A typed command is submitted the way a person would: Enter completes it.
          enter: true,
          deviceToken: args.deviceToken
        })
      )
    )
    return accepted === true
  } catch {
    return false
  }
}
