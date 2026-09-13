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
}): Promise<MacHostCommandOutcome> {
  const outcome = await watchThrowawayTerminal({
    client: args.client,
    worktreeId: args.worktreeId,
    command: args.command,
    timeoutMs: MAC_HOST_COMMAND_TIMEOUT_MS,
    read: (lines) => (lines.some((line) => MAC_HOST_COMMAND_DONE_PATTERN.test(line)) ? true : null)
  })
  return outcome.ok ? { ok: true } : outcome
}
