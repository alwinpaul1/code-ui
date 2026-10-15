import type { TerminalPermissionMode } from './claude-terminal-mode-footer'

/**
 * Where a pick in the Select mode sheet goes. A matched Claude tab whose Anthropic link is live
 * sets it as the Claude app does, `set_permission_mode` on the session's events
 * (use-ccr-control-lane.ts), and presses nothing: Shift+Tab needs the relay and the terminal,
 * and with the relay down it cannot run at all (parity audit 2026-10-15, gap 3). Without that
 * lane the terminal's Shift+Tab stepping stays the route. A failure is said once, in the words
 * the route gives.
 */
export async function pickPermissionMode(args: {
  mode: TerminalPermissionMode
  /** The lane's `set_permission_mode`: the failure's words or null; absent when not live. */
  viaAnthropic: ((mode: TerminalPermissionMode) => Promise<string | null>) | undefined
  /** Shift+Tab until the footer shows the mode; false when it never did. */
  stepTerminal: (mode: TerminalPermissionMode) => Promise<boolean>
  say: (message: string) => void
}): Promise<void> {
  if (args.viaAnthropic) {
    const failed = await args.viaAnthropic(args.mode)
    if (failed) {
      args.say(failed)
    }
    return
  }
  if (!(await args.stepTerminal(args.mode))) {
    args.say('That mode is not available in this session')
  }
}
