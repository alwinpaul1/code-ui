import { MAC_HOST_COMMAND_DONE_PATTERN } from './mac-host-commands'
import { watchThrowawayTerminal, type ThrowawayTerminalClient } from './throwaway-terminal'

export type MacHostCommandOutcome = { ok: true } | { ok: false; reason: string }

/** Long enough for `osascript` to finish typing at the login window; after this the
 *  tab is closed whether or not the shell said it was done. */
export const MAC_HOST_COMMAND_TIMEOUT_MS = 10_000

// Why a terminal at all: there is no generic "run this on the host" RPC. A startup
// command in a throwaway tab is the only route. The command ends by printing a done
// marker; the phone waits for it and closes the tab, which is how the desktop is left
// with no "Terminal N" behind.
export async function runMacHostCommand(args: {
  client: ThrowawayTerminalClient
  worktreeId: string
  command: string
  /** Set for unlock: no host text about this command may be shown. */
  secret?: boolean
}): Promise<MacHostCommandOutcome> {
  const outcome = await watchThrowawayTerminal({
    client: args.client,
    worktreeId: args.worktreeId,
    command: args.command,
    timeoutMs: MAC_HOST_COMMAND_TIMEOUT_MS,
    secret: args.secret,
    read: (lines) => (lines.some((line) => MAC_HOST_COMMAND_DONE_PATTERN.test(line)) ? true : null)
  })
  if (!outcome.ok) {
    return outcome
  }
  // The shell prints the marker once the command is through. Never seeing it
  // inside the budget means it did not finish — a wrong unlock password, or
  // osascript refused Accessibility. Reporting that as success left both
  // outcomes ending in silence (2026-09-14 review).
  return outcome.answer === true
    ? { ok: true }
    : { ok: false, reason: 'The Mac did not finish that. Check the desktop.' }
}
