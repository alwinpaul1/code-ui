import { claudeRowsUnderBox } from './claude-composer-screen'
import { codexComposerLive } from './codex-composer-screen'
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

/**
 * Whether the screen is a live Claude frame: the box `readClaudeInput` locates,
 * AND under its bottom rule at least one row, every one indented two spaces.
 * Claude Code indents everything it draws under the box (the HUD and status
 * rows, the `⏵⏵ … mode` footer, `? for shortcuts`); every composer screen in
 * fixtures/ (2.1.278 to 2.1.287, incl. the 2.1.285 named-rule capture and the
 * 2.1.287 box) has two to five such rows and none at column 0. A row at column
 * 0 under the box is something else drawn after it: a shell prompt, a restore
 * banner, a prompt with an RPROMPT. And a box with NOTHING under it is not
 * shown to be a whole Claude frame (every fixture has a footer), so it
 * refuses: a false refusal costs "Send again", a false follow types into a shell.
 * Not checked against the 2.1.287 binary for column-0 rows under the box.
 *
 * Residual, for a device check: a restored PTY's emulator is SEEDED with the old
 * scrollback (a cold restore or a wake after sleep starts a new incarnation and
 * re-mints the handle; upstream spawn-commit.ts and daemon-pty-adapter.ts). If
 * that seed includes Claude's indented footer rows and the new process has drawn
 * nothing yet, this still reads as Claude. Wake a sleeping Claude tab and read
 * its screen before the agent paints to settle it.
 */
export function claudeLiveFrame(lines: readonly string[]): boolean {
  const below = claudeRowsUnderBox(lines)
  return below !== null && below.length > 0 && below.every((row) => row.startsWith('  '))
}

/** The screen read the verification takes; the look's own. */
const SCREEN_READ_MS = 2_000

/**
 * Positive evidence that `terminal`'s screen is the agent's composer, read
 * fresh: `readClaudeInput` locates the `❯` row between the box's two rules.
 * Claude and Codex have a reader that tells their composer from everything
 * else on screen. Codex draws its input with `›`, and so does a sent prompt, a
 * popup's selected row and an approval's selected option
 * (codex-terminal-queued-messages.ts), so for Codex the proof is that row with only
 * indented rows under it, at least one for a follow (codexComposerLive, which says
 * which captures stand behind it). Any other agent and a read that fails or times out are false.
 * `located: false` (a shell, a dialog, a `!` bash-mode box, a screen not drawn
 * yet) is no evidence either, nor is a box with a column-0 row or nothing under it
 * (claudeLiveFrame).
 *
 * What this does not prove. The screen is the runtime's per-PTY emulator
 * (orca-runtime.ts, `headlessTerminals` keyed by ptyId; Orca 1.4.178-rc.2 has no
 * `screen: true` handling, 1.4.197 reads it through `readRenderedScreen` ->
 * `readVisibleTerminalState`). A handle re-minted for the SAME PTY (a renderer
 * reload clears `handles`) keeps its screen, so an agent that exited before the
 * reload leaves its box above the shell; the send was already allowed to that PTY
 * before the remint (the tab's `agent` is no proof of life either), so following
 * adds no exposure. A NEW PTY is NOT always blank: a cold restore or a wake after
 * sleep starts a new incarnation, re-mints the handle and SEEDS the emulator with
 * the old scrollback (upstream ef428d87, spawn-commit.ts:51-61,
 * daemon-pty-adapter.ts:678-697), and the recovery seed
 * `replaceHeadlessTerminalFromRendererSnapshotForRecovery` writes the renderer's
 * frame into it. claudeLiveFrame refuses what that leaves under the box.
 * (Pre-existing: screenLinesReader accepts a reply with no `source` as a screen read.)
 * Claude's hooks cannot say the agent is gone (no SessionEnd handling in
 * claude-events.ts; SessionStart lands before any remint is seen).
 */
export async function agentComposerOnScreen(args: {
  client: Parameters<typeof terminalScreenLinesRead.request>[0]
  terminal: string
  agent?: string | null
  deadline?: number
}): Promise<boolean> {
  if (args.agent !== 'claude' && args.agent !== 'codex') {
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
    return (
      lines !== null &&
      (args.agent === 'codex'
        ? codexComposerLive(lines, { underneath: true })
        : claudeLiveFrame(lines))
    )
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
