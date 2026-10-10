import {
  MAC_HOST_COMMAND_DONE_PATTERN,
  MAC_HOST_REFUSAL_REASONS,
  readMacHostRefusal,
  type MacHostRefusal
} from './mac-host-commands'
import { watchThrowawayTerminal, type ThrowawayTerminalClient } from './throwaway-terminal'
import { readWindowsDimReport, type WindowsDimReport } from './windows-host-commands'

/** `dim`: what Sleep display did on a Windows PC with Modern Standby, which dims and
 *  covers the screens instead of turning them off (windows-display-dim-keeper.ts). */
export type MacHostCommandOutcome = { ok: true; dim?: WindowsDimReport } | { ok: false; reason: string }

/** Long enough for `osascript` to finish typing at the login window; after this the
 *  tab is closed whether or not the shell said it was done. */
export const MAC_HOST_COMMAND_TIMEOUT_MS = 10_000
/** A cold `powershell` start plus the C# each Windows script compiles; measured on
 *  nothing yet (no Windows machine has run these), so given half as much again. */
export const WINDOWS_HOST_COMMAND_TIMEOUT_MS = 15_000

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
  timeoutMs?: number
  /** How the host is named in the one failure this can report. */
  hostNoun?: string
}): Promise<MacHostCommandOutcome> {
  const outcome = await watchThrowawayTerminal<MacHostRefusal | 'done' | WindowsDimReport>({
    client: args.client,
    worktreeId: args.worktreeId,
    command: args.command,
    timeoutMs: args.timeoutMs ?? MAC_HOST_COMMAND_TIMEOUT_MS,
    secret: args.secret,
    ...(args.hostNoun ? { hostNoun: args.hostNoun } : {}),
    // A refusal is the command saying it did nothing (mac-host-commands.ts); it
    // ends the watch as the done marker does.
    // The dim report is printed just before the done marker, so a screen with the
    // marker has it too.
    read: (lines) =>
      readMacHostRefusal(lines) ??
      (lines.some((line) => MAC_HOST_COMMAND_DONE_PATTERN.test(line)) ? (readWindowsDimReport(lines) ?? 'done') : null)
  })
  if (!outcome.ok) {
    return outcome
  }
  if (outcome.answer !== null && typeof outcome.answer === 'object') {
    return { ok: true, dim: outcome.answer }
  }
  if (outcome.answer !== null && outcome.answer !== 'done') {
    // A fixed line chosen by the marker, never the host's text: the unlock's screen
    // carries the password.
    return { ok: false, reason: MAC_HOST_REFUSAL_REASONS[outcome.answer] }
  }
  // The shell prints the marker once the command is through, whether or not
  // osascript succeeded. Never seeing it inside the budget means the command did
  // not get through: a shell that never ran it, or an osascript still running.
  // Reporting that as success ended it in silence (2026-09-14 review).
  return outcome.answer === 'done'
    ? { ok: true }
    : { ok: false, reason: `The ${args.hostNoun ?? 'Mac'} did not finish that. Check the desktop.` }
}
