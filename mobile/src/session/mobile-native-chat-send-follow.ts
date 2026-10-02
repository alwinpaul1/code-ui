import { readClaudeInput } from './claude-composer-screen'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import type { MobileSessionTab } from './mobile-session-route-types'
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

/** The screen read the verification takes; the look's own. */
const SCREEN_READ_MS = 2_000

/**
 * Positive evidence that `terminal`'s screen is the agent's composer, read
 * fresh: `readClaudeInput` locates the `❯` row between the box's two rules.
 * Only Claude has a reader that tells its composer from everything else on
 * screen. Codex draws its input with `›`, and so does a sent prompt, a popup's
 * selected row and an approval's selected option
 * (codex-terminal-queued-messages.ts), so no screen proves Codex's composer is
 * up: Codex, any other agent and a read that fails or times out are all false.
 * `located: false` (a shell, a dialog, a `!` bash-mode box, a screen not drawn
 * yet) is no evidence either.
 *
 * What this does not prove (Orca 1.4.178-rc.2, orca-runtime.ts): the screen is
 * the runtime's per-PTY emulator (`headlessTerminals`, keyed by ptyId, disposed
 * when the PTY exits), so a NEW PTY starts blank and cannot show the old box.
 * A handle re-minted for the SAME PTY (a renderer reload clears `handles`) keeps
 * its screen, so an agent that exited before the reload leaves its box above the
 * shell. The send was already allowed to that PTY before the remint (the tab's
 * `agent` is no proof of life either), so following it adds no exposure. The
 * emulator can be seeded from a restored session or replaced by the renderer's
 * visible snapshot (readRendererVisibleSnapshotLines), which are not excluded.
 * Claude's hooks cannot say the agent is gone (no SessionEnd handling in
 * claude-events.ts; SessionStart lands before any remint is seen).
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
    return lines !== null && readClaudeInput(lines, '').located
  } catch {
    return false
  }
}

/**
 * The terminal the host's latest session-tab snapshot names for the tab with
 * this scope key, or null. A handle the phone's own state moved to (closing the
 * active terminal re-points the active handle at another tab's) is not this
 * tab's until the snapshot says so: identity comes from the host.
 */
export function hostTerminalOfTab(
  tabs: readonly MobileSessionTab[],
  hostId: string,
  worktreeId: string,
  scopeKey: string
): string | null {
  const tab = tabs.find(
    (candidate) => mobileNativeChatScopeKey(hostId, worktreeId, candidate.id) === scopeKey
  )
  return tab?.type === 'terminal' && typeof tab.terminal === 'string' ? tab.terminal : null
}
